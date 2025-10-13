export interface LlmClient {
  summarize(text: string, opts?: { maxTokens?: number }): Promise<string>;
}

export class NoopLlmClient implements LlmClient {
  async summarize(text: string): Promise<string> {
    return text.slice(0, 500);
  }
}
