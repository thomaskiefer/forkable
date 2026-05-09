export type AIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type StreamCompletionParams = {
  model: string;
  messages: AIChatMessage[];
};

export interface AIProvider {
  streamCompletion(params: StreamCompletionParams): Promise<AsyncIterable<string>>;
}
