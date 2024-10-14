import OpenAI from 'openai';
import {
  Agent,
  AgentFunction,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall,
  Function,
  Response,
  Result,
} from './types';
import { functionToJson, debugPrint, mergeChunk } from './util';

const __CTX_VARS_NAME__ = 'context_variables';

export class Swarm {
  private client: OpenAI;

  constructor(client?: OpenAI) {
    this.client = client || new OpenAI();
  }

  private async getChatCompletion(
    agent: Agent,
    history: ChatCompletionMessage[],
    contextVariables: Record<string, any>,
    modelOverride: string | undefined,
    stream: boolean,
    debug: boolean
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const instructions = typeof agent.instructions === 'function'
      ? agent.instructions(contextVariables)
      : agent.instructions;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: instructions },
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
        function_call: msg.function_call,
        tool_calls: msg.tool_calls,
      })),
    ];
    debugPrint(debug, 'Getting chat completion for...:', messages);

    const tools = agent.functions.map(f => functionToJson(f));
    // Hide context_variables from model
    tools.forEach(tool => {
      const params = tool.function.parameters;
      delete params.properties[__CTX_VARS_NAME__];
      if (params.required) {
        params.required = params.required.filter((p: string) => p !== __CTX_VARS_NAME__);
      }
    });

    const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: modelOverride || agent.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: agent.toolChoice,
      stream,
    };

    if (tools.length > 0 && agent.parallelToolCalls) {
      createParams.tool_choice = 'auto';
    }

    const completion = await this.client.chat.completions.create(createParams);
    return completion as OpenAI.Chat.Completions.ChatCompletion;
  }

  private handleFunctionResult(result: any, debug: boolean): Result {
    if (result instanceof Result) {
      return result;
    }

    if (typeof result === 'object' && 'name' in result) {
      return new Result({
        value: JSON.stringify({ assistant: result.name }),
        agent: result as Agent,
      });
    }

    try {
      return new Result({ value: String(result) });
    } catch (e) {
      const errorMessage = `Failed to cast response to string: ${result}. Make sure agent functions return a string or Result object. Error: ${e}`;
      debugPrint(debug, errorMessage);
      throw new TypeError(errorMessage);
    }
  }

  private async handleToolCalls(
    toolCalls: ChatCompletionMessageToolCall[],
    functions: AgentFunction[],
    contextVariables: Record<string, any>,
    debug: boolean
  ): Promise<Response> {
    const functionMap = new Map(functions.map(f => [f.name, f]));
    const partialResponse: Response = {
      messages: [],
      agent: null,
      contextVariables: {},
    };

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      if (!functionMap.has(name)) {
        debugPrint(debug, `Tool ${name} not found in function map.`);
        partialResponse.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name,
          content: `Error: Tool ${name} not found.`,
        });
        continue;
      }

      const args = JSON.parse(toolCall.function.arguments);
      debugPrint(debug, `Processing tool call: ${name} with arguments ${args}`);

      const func = functionMap.get(name)!;
      if (func.length > 0 && __CTX_VARS_NAME__ in args) {
        args[__CTX_VARS_NAME__] = contextVariables;
      }

      const rawResult = await func(args);
      const result = this.handleFunctionResult(rawResult, debug);

      partialResponse.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name,
        content: result.value,
      });

      partialResponse.contextVariables = {
        ...partialResponse.contextVariables,
        ...result.contextVariables,
      };

      if (result.agent) {
        partialResponse.agent = result.agent;
      }
    }

    return partialResponse;
  }

  async run(
    agent: Agent,
    messages: ChatCompletionMessage[],
    contextVariables: Record<string, any> = {},
    modelOverride?: string,
    stream = false,
    debug = false,
    maxTurns = Infinity,
    executeTools = true
  ): Promise<Response> {
    let activeAgent = agent;
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < maxTurns && activeAgent) {
      const completion = await this.getChatCompletion(
        activeAgent,
        history,
        contextVariables,
        modelOverride,
        stream,
        debug
      );

      const message = completion.choices[0].message as ChatCompletionMessage;
      debugPrint(debug, 'Received completion:', message);
      message.sender = activeAgent.name;
      history.push(message);

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, 'Ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent.functions,
        contextVariables,
        debug
      );

      history.push(...partialResponse.messages);
      contextVariables = { ...contextVariables, ...partialResponse.contextVariables };

      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    return {
      messages: history.slice(initLen),
      agent: activeAgent,
      contextVariables,
    };
  }
}
