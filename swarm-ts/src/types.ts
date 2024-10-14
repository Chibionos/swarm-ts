import { ChatCompletionCreateParams, ChatCompletionMessage as OpenAIChatCompletionMessage } from 'openai/resources/chat';

export interface Agent {
  name: string;
  model: string;
  instructions: string | ((contextVariables: Record<string, any>) => string);
  functions: AgentFunction[];
  toolChoice?: ChatCompletionCreateParams.ChatCompletionToolChoiceOption;
  parallelToolCalls?: number;
}

export type AgentFunction = (args: Record<string, any>) => Promise<string | Agent | Record<string, any>>;

export interface Response {
  messages: ChatCompletionMessage[];
  agent: Agent | null;
  contextVariables: Record<string, any>;
}

export class Result {
  value: string;
  agent?: Agent;
  contextVariables: Record<string, any>;

  constructor({ value = '', agent, contextVariables = {} }: Partial<Result> = {}) {
    this.value = value;
    this.agent = agent;
    this.contextVariables = contextVariables;
  }
}

export interface ChatCompletionMessage extends OpenAIChatCompletionMessage {
  sender?: string;
}

export { ChatCompletionMessageToolCall, Function } from 'openai/resources/chat/completions';
