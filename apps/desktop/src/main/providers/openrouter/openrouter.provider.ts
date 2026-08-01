import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class OpenRouterProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'openrouter', name: 'OpenRouter', kind: 'openrouter' });
  }
}
