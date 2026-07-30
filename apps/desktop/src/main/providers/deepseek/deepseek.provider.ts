import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'deepseek', name: 'DeepSeek', kind: 'deepseek' });
  }
}
