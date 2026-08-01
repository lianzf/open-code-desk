import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class GlmProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'glm', name: 'Zhipu GLM', kind: 'glm' });
  }
}
