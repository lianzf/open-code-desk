import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProviderConfigRepository } from '../providers/provider-config.repository';
import { ModelConfigRepository } from '../providers/model-config.repository';
import { AppSettingsRepository } from '../settings/app-settings.repository';
import { AppSettingsService } from '../settings/app-settings.service';
import { createAppDatabase } from './database';

const temporaryPaths: string[] = [];
const providerId = '1c9f4764-13b6-4e18-8b62-baf9c6201cd8';

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

function saveProvider(repository: ProviderConfigRepository): void {
  repository.save({
    id: providerId,
    kind: 'openai-compatible',
    displayName: 'Fixture',
    baseUrl: 'https://models.example.test/v1',
    defaultModel: 'model-1',
    contextWindow: 32_000,
    toolCalling: true,
    vision: false,
    streaming: true,
    customHeaders: {},
    sensitiveHeaderNames: [],
    hasApiKey: false,
  });
}

describe('model and application settings persistence', () => {
  it('migrates and persists model metadata across database restarts', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-model-settings-'));
    temporaryPaths.push(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');

    const firstDatabase = createAppDatabase(databasePath);
    saveProvider(new ProviderConfigRepository(firstDatabase));
    new ModelConfigRepository(firstDatabase).replaceForProvider(providerId, [
      {
        id: 'model-1',
        name: 'Model One',
        ownedBy: 'fixture',
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
          reasoning: false,
          structuredOutput: true,
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      },
    ]);
    firstDatabase.close();

    const reopenedDatabase = createAppDatabase(databasePath);
    const models = new ModelConfigRepository(reopenedDatabase).listForProvider(providerId);
    const version = reopenedDatabase.client.prepare('PRAGMA user_version').get() as {
      readonly user_version: number;
    };
    reopenedDatabase.close();

    expect(version.user_version).toBeGreaterThanOrEqual(5);
    expect(models).toEqual([
      {
        id: 'model-1',
        name: 'Model One',
        ownedBy: 'fixture',
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
          reasoning: false,
          structuredOutput: true,
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      },
    ]);
  });

  it('restores the selected provider and model and prunes deleted providers', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-app-settings-'));
    temporaryPaths.push(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');

    const firstDatabase = createAppDatabase(databasePath);
    const firstProviders = new ProviderConfigRepository(firstDatabase);
    saveProvider(firstProviders);
    const firstService = new AppSettingsService(
      new AppSettingsRepository(firstDatabase),
      firstProviders,
    );
    firstService.update({
      selectedProviderId: providerId,
      selectedModels: { [providerId]: 'model-2' },
    });
    firstDatabase.close();

    const reopenedDatabase = createAppDatabase(databasePath);
    const reopenedProviders = new ProviderConfigRepository(reopenedDatabase);
    const reopenedService = new AppSettingsService(
      new AppSettingsRepository(reopenedDatabase),
      reopenedProviders,
    );
    expect(reopenedService.get()).toMatchObject({
      selectedProviderId: providerId,
      selectedModels: { [providerId]: 'model-2' },
    });

    reopenedProviders.delete(providerId);
    expect(reopenedService.get()).toMatchObject({ selectedModels: {} });
    reopenedDatabase.close();
  });

  it('merges desktop preference patches without overwriting model selection', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-preferences-'));
    temporaryPaths.push(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');

    const database = createAppDatabase(databasePath);
    const providers = new ProviderConfigRepository(database);
    saveProvider(providers);
    const service = new AppSettingsService(new AppSettingsRepository(database), providers);
    service.update({
      selectedProviderId: providerId,
      selectedModels: { [providerId]: 'model-2' },
    });
    service.update({ theme: 'light', locale: 'en-US', autoCheckUpdates: false });

    expect(service.get()).toMatchObject({
      selectedProviderId: providerId,
      selectedModels: { [providerId]: 'model-2' },
      theme: 'light',
      locale: 'en-US',
      autoCheckUpdates: false,
    });
    database.close();
  });
});
