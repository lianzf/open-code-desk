import { describe, expect, it } from 'vitest';

import { ProviderRegistry, ProviderRegistryError, type ModelProvider } from './index';

const provider: ModelProvider = {
  id: 'openai-compatible',
  name: 'OpenAI Compatible',
  kind: 'openai-compatible',
  async validateConfig() {
    return { valid: true, message: 'ok' };
  },
  async listModels() {
    return [];
  },
  async *streamChat() {
    yield { type: 'message_end', finishReason: 'stop' };
  },
  async getCapabilities(config) {
    return config.capabilities;
  },
};

describe('ProviderRegistry', () => {
  it('registers and resolves a provider without vendor branching', () => {
    const registry = new ProviderRegistry();

    registry.register(provider);

    expect(registry.get('openai-compatible')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it('rejects duplicate provider kinds', () => {
    const registry = new ProviderRegistry();
    registry.register(provider);

    expect(() => registry.register(provider)).toThrowError(
      expect.objectContaining<Partial<ProviderRegistryError>>({
        code: 'PROVIDER_ALREADY_REGISTERED',
      }),
    );
  });

  it('rejects unknown provider kinds', () => {
    const registry = new ProviderRegistry();

    expect(() => registry.get('openai-compatible')).toThrowError(
      expect.objectContaining<Partial<ProviderRegistryError>>({
        code: 'PROVIDER_NOT_REGISTERED',
      }),
    );
  });
});
