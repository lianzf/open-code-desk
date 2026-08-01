import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class OllamaProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'ollama', name: 'Ollama', kind: 'ollama' });
  }
}
