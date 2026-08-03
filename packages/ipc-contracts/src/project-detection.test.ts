import { describe, expect, it } from 'vitest';

import { detectProjectRequestSchema } from './project-detection';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('detectProjectRequestSchema', () => {
  it.each(['zh-CN', 'en-US'] as const)('accepts the supported locale %s', (locale) => {
    expect(detectProjectRequestSchema.parse({ workspaceId, locale })).toEqual({
      workspaceId,
      locale,
    });
  });

  it('requires a supported locale and rejects unknown properties', () => {
    expect(() => detectProjectRequestSchema.parse({ workspaceId })).toThrow();
    expect(() => detectProjectRequestSchema.parse({ workspaceId, locale: 'fr-FR' })).toThrow();
    expect(() =>
      detectProjectRequestSchema.parse({ workspaceId, locale: 'en-US', unexpected: true }),
    ).toThrow();
  });
});
