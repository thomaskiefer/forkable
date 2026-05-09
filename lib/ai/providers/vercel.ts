import { createGateway } from '@ai-sdk/gateway';
import { streamText } from 'ai';
import type { AIProvider, StreamCompletionParams } from '@/lib/ai/types';

function getGateway() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const baseURL = process.env.AI_GATEWAY_BASE_URL;

  return createGateway({
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  });
}

function buildByokOptions(): Record<string, Record<string, Array<{ apiKey: string }>>> {
  const byok: Record<string, Array<{ apiKey: string }>> = {};

  const providers: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    'x-ai': process.env.XAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
  };

  for (const [name, key] of Object.entries(providers)) {
    if (key) byok[name] = [{ apiKey: key }];
  }

  return Object.keys(byok).length > 0 ? { byok } : {};
}

export function createVercelAIProvider(): AIProvider {
  return {
    async streamCompletion(params: StreamCompletionParams) {
      const gateway = getGateway();
      const result = streamText({
        model: gateway(params.model),
        messages: params.messages,
        providerOptions: {
          gateway: buildByokOptions(),
        },
      });

      return {
        async *[Symbol.asyncIterator]() {
          for await (const delta of result.textStream) {
            if (delta) yield delta;
          }
        },
      };
    },
  };
}
