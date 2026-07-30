import { OpenAICompatibleProvider } from '../openai-compatible/openai-compatible.provider';

export class QwenProvider extends OpenAICompatibleProvider {
  public constructor() {
    super({ id: 'qwen', name: 'Alibaba Cloud Qwen', kind: 'qwen' });
  }
}
