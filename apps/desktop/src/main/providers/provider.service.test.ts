import { describe, expect, it } from 'vitest';
import type { ModelInfo, ModelProvider } from '@open-code-desk/provider-core';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { createAppDatabase } from '../database/database';
import type { SecretStore } from '../security/secret-store';
import { ProviderConfigRepository } from './provider-config.repository';
import { ModelConfigRepository } from './model-config.repository';
import { ProviderService } from './provider.service';

class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  public async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  public async get(ref: string): Promise<string | null> {
    return this.values.get(ref) ?? null;
  }

  public async has(ref: string): Promise<boolean> {
    return this.values.has(ref);
  }

  public async delete(ref: string): Promise<boolean> {
    return this.values.delete(ref);
  }
}

function createProvider(
  observedApiKeys: string[],
  models: ReadonlyArray<ModelInfo> = [],
): ModelProvider {
  return {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    kind: 'openai-compatible',
    async validateConfig(_config, context) {
      observedApiKeys.push(context.apiKey ?? '');
      return { valid: true, message: 'ok' };
    },
    async listModels() {
      return models;
    },
    async *streamChat() {
      yield { type: 'message_end', finishReason: 'stop' };
    },
    async getCapabilities(config) {
      return config.capabilities;
    },
  };
}

describe('ProviderService', () => {
  it('persists only public configuration and never returns a secret', async () => {
    const database = createAppDatabase(':memory:');
    const secrets = new MemorySecretStore();
    const observedApiKeys: string[] = [];
    const registry = new ProviderRegistry();
    registry.register(
      createProvider(observedApiKeys, [
        {
          id: 'model-1',
          name: 'Model One',
          ownedBy: 'fixture',
          capabilities: {
            streaming: true,
            toolCalling: true,
            vision: false,
            reasoning: false,
            structuredOutput: true,
            contextWindow: 32_000,
            maxOutputTokens: 4_096,
          },
        },
      ]),
    );
    const service = new ProviderService(
      new ProviderConfigRepository(database),
      new ModelConfigRepository(database),
      secrets,
      registry,
    );

    const saved = await service.save({
      kind: 'openai-compatible',
      displayName: 'Fixture',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'sk-private-value',
      defaultModel: 'model-1',
      contextWindow: 32_000,
      toolCalling: true,
      vision: false,
      streaming: true,
      customHeaders: [
        { name: 'X-Tenant', value: 'public-tenant', sensitive: false },
        { name: 'X-API-Token', value: 'private-token', sensitive: false },
      ],
    });

    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('sk-private-value');
    expect(JSON.stringify(saved)).not.toContain('private-token');
    const row = database.client
      .prepare('SELECT custom_headers, sensitive_header_names, has_api_key FROM provider_configs')
      .get() as {
      readonly custom_headers: string;
      readonly sensitive_header_names: string;
      readonly has_api_key: number;
    };
    expect(row.custom_headers).toContain('public-tenant');
    expect(row.custom_headers).not.toContain('private-token');
    expect(row.sensitive_header_names).toContain('X-API-Token');

    await expect(service.listModels(saved.id)).resolves.toHaveLength(1);
    const modelRow = database.client
      .prepare(
        'SELECT model_id, context_window, structured_output FROM model_configs WHERE provider_config_id = ?',
      )
      .get(saved.id) as {
      readonly context_window: number;
      readonly model_id: string;
      readonly structured_output: number;
    };
    expect(modelRow).toEqual({
      context_window: 32_000,
      model_id: 'model-1',
      structured_output: 1,
    });

    await expect(service.testConnection(saved.id)).resolves.toEqual({
      valid: true,
      message: 'ok',
    });
    expect(observedApiKeys).toEqual(['sk-private-value']);
    database.close();
  });

  it('preserves a masked secret on update and removes the obsolete secret reference', async () => {
    const database = createAppDatabase(':memory:');
    const secrets = new MemorySecretStore();
    const registry = new ProviderRegistry();
    registry.register(createProvider([]));
    const service = new ProviderService(
      new ProviderConfigRepository(database),
      new ModelConfigRepository(database),
      secrets,
      registry,
    );
    const initial = await service.save({
      kind: 'openai-compatible',
      displayName: 'Initial',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'keep-me',
      defaultModel: 'model-1',
      contextWindow: 8_192,
      toolCalling: false,
      vision: false,
      streaming: true,
      customHeaders: [],
    });
    const oldRef = [...secrets.values.keys()][0];

    const updated = await service.save({
      id: initial.id,
      kind: 'openai-compatible',
      displayName: 'Updated',
      baseUrl: initial.baseUrl,
      defaultModel: 'model-2',
      contextWindow: 16_384,
      toolCalling: true,
      vision: false,
      streaming: true,
      customHeaders: [],
    });

    expect(updated.displayName).toBe('Updated');
    expect(updated.hasApiKey).toBe(true);
    expect(secrets.values.has(oldRef ?? '')).toBe(false);
    expect([...secrets.values.values()].join('')).toContain('keep-me');
    database.close();
  });
});
