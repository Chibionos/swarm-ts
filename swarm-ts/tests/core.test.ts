import { Swarm } from '../src/core';
import { Agent, ChatCompletionMessage } from '../src/types';
import OpenAI from 'openai';

jest.mock('openai');

describe('Swarm', () => {
  let mockOpenAI: jest.Mocked<OpenAI>;
  let swarm: Swarm;

  beforeEach(() => {
    mockOpenAI = new OpenAI() as jest.Mocked<OpenAI>;
    mockOpenAI.chat = {
      completions: {
        create: jest.fn(),
      },
    } as any;
    swarm = new Swarm(mockOpenAI);
  });

  test('run with simple message', async () => {
    const agent: Agent = {
      name: 'TestAgent',
      model: 'gpt-4',
      instructions: 'You are a helpful assistant.',
      functions: [],
    };

    const messages: ChatCompletionMessage[] = [{ role: 'user', content: 'Hello, how are you?' }];

    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      id: 'test-id',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: "I'm doing well, thank you for asking! How can I assist you today?",
          },
        },
      ],
      created: 1234567890,
      model: 'gpt-4',
      object: 'chat.completion',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const response = await swarm.run(agent, messages);

    expect(response.messages[0].role).toBe('assistant');
    expect(response.messages[0].content).toBe("I'm doing well, thank you for asking! How can I assist you today?");
  });

  // Add more tests here for different scenarios
});
