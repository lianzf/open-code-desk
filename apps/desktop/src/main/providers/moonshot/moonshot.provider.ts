import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class MoonshotProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'moonshot', name: 'Moonshot / Kimi', kind: 'moonshot' });
  }
}
