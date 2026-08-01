import { describe, expect, it } from 'vitest';

import { providerKindSchema, saveProviderRequestSchema } from './providers';

const providerKinds = providerKindSchema.options;

describe('provider IPC contracts', () => {
  it.each(providerKinds)('accepts a secure configuration for %s', (kind) => {
    expect(
      saveProviderRequestSchema.parse({
        kind,
        displayName: `Fixture ${kind}`,
        baseUrl: kind === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1',
        defaultModel: 'fixture-model',
        contextWindow: 128_000,
        toolCalling: true,
        vision: false,
        streaming: true,
        customHeaders: [],
      }).kind,
    ).toBe(kind);
  });

  it('rejects unknown provider kinds', () => {
    expect(() =>
      saveProviderRequestSchema.parse({
        kind: 'unknown-provider',
        displayName: 'Unknown',
        baseUrl: 'https://api.example.com/v1',
        defaultModel: 'fixture-model',
        contextWindow: 128_000,
        toolCalling: true,
        vision: false,
        streaming: true,
        customHeaders: [],
      }),
    ).toThrow();
  });
});
