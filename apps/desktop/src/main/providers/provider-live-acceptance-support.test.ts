import { describe, expect, it } from 'vitest';

import {
  formatLiveProviderFailure,
  liveProviderTargets,
  parseLiveProviderSelection,
  readLiveProviderSettings,
} from './provider-live-acceptance-support.acceptance';

function target(kind: (typeof liveProviderTargets)[number]['kind']) {
  return liveProviderTargets.find((entry) => entry.kind === kind)!;
}

describe('live Provider acceptance support', () => {
  it('keeps live network acceptance disabled unless explicitly selected', () => {
    expect([...parseLiveProviderSelection(undefined)]).toEqual([]);
    expect([...parseLiveProviderSelection('openai, anthropic')]).toEqual(['openai', 'anthropic']);
    expect([...parseLiveProviderSelection('all')]).toHaveLength(liveProviderTargets.length);
  });

  it('rejects unknown selectors before making a network request', () => {
    expect(() => parseLiveProviderSelection('openai,unknown')).toThrow(
      'Unsupported live Provider selector(s): unknown',
    );
  });

  it('requires the exact non-secret fields and official service API key', () => {
    expect(() => readLiveProviderSettings(target('openai'), {})).toThrow(
      'OPEN_CODE_DESK_PROVIDER_OPENAI_BASE_URL, OPEN_CODE_DESK_PROVIDER_OPENAI_MODEL, OPEN_CODE_DESK_PROVIDER_OPENAI_API_KEY',
    );
  });

  it('accepts an explicitly selected keyless local-compatible target and validates headers', () => {
    expect(
      readLiveProviderSettings(target('openai-compatible'), {
        OPEN_CODE_DESK_PROVIDER_OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:11434/v1/',
        OPEN_CODE_DESK_PROVIDER_OPENAI_COMPATIBLE_MODEL: 'fixture-model',
        OPEN_CODE_DESK_PROVIDER_OPENAI_COMPATIBLE_HEADERS_JSON:
          '{"X-Acceptance-Token":"temporary-secret"}',
      }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'fixture-model',
      customHeaders: { 'X-Acceptance-Token': 'temporary-secret' },
      secretValues: ['temporary-secret'],
    });
  });

  it('redacts API keys and custom header values from a surfaced failure', () => {
    expect(
      formatLiveProviderFailure(
        'openai',
        new Error('request rejected key-live-secret tenant-live-secret'),
        ['key-live-secret', 'tenant-live-secret'],
      ),
    ).toBe('openai live acceptance failed: Error: request rejected [REDACTED] [REDACTED]');
  });
});
