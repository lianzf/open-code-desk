import { describe, expect, it } from 'vitest';

import {
  appSettingsSchema,
  defaultShortcutSettings,
  shortcutSettingsSchema,
  updateAppSettingsRequestSchema,
} from './settings';

describe('application settings IPC contract', () => {
  it('accepts a provider and model selection', () => {
    const providerId = '1c9f4764-13b6-4e18-8b62-baf9c6201cd8';
    expect(
      updateAppSettingsRequestSchema.parse({
        selectedProviderId: providerId,
        selectedModels: { [providerId]: 'model-1' },
      }),
    ).toEqual({
      selectedProviderId: providerId,
      selectedModels: { [providerId]: 'model-1' },
    });
  });

  it('adds safe desktop defaults to persisted legacy settings', () => {
    expect(appSettingsSchema.parse({ selectedModels: {} })).toEqual({
      selectedModels: {},
      theme: 'system',
      locale: 'zh-CN',
      shortcuts: defaultShortcutSettings,
      autoCheckUpdates: true,
      crashReporting: true,
    });
  });

  it('accepts partial preference updates and rejects conflicting shortcuts', () => {
    expect(updateAppSettingsRequestSchema.parse({ theme: 'light' })).toEqual({
      theme: 'light',
    });
    expect(() =>
      shortcutSettingsSchema.parse({
        ...defaultShortcutSettings,
        toggleGit: 'Shift+Ctrl+Comma',
      }),
    ).toThrow(/conflicts/i);
    expect(() =>
      shortcutSettingsSchema.parse({
        ...defaultShortcutSettings,
        toggleGit: 'Ctrl+Cmd+G',
      }),
    ).toThrow(/cannot be combined/i);
    expect(() => updateAppSettingsRequestSchema.parse({})).toThrow();
  });

  it('rejects malformed provider ids and unknown fields', () => {
    expect(() =>
      appSettingsSchema.parse({
        selectedProviderId: 'not-a-uuid',
        selectedModels: {},
      }),
    ).toThrow();
    expect(() =>
      appSettingsSchema.parse({
        selectedModels: {},
        apiKey: 'must-not-be-stored-here',
      }),
    ).toThrow();
  });
});
