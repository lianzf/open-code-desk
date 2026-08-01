import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class OpenAIProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'openai', name: 'OpenAI', kind: 'openai' });
  }
}
