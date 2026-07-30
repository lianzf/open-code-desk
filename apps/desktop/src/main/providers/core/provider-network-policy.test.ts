import { describe, expect, it } from 'vitest';

import {
  assertSafeProviderEndpoint,
  isSensitiveHeaderName,
  validateCustomHeader,
  validateProviderBaseUrl,
} from './provider-network-policy';

describe('provider network policy', () => {
  it('normalizes HTTPS and local HTTP base URLs', () => {
    expect(validateProviderBaseUrl('https://models.example.test/v1/')).toBe(
      'https://models.example.test/v1',
    );
    expect(validateProviderBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1');
  });

  it('rejects credential-bearing and remote plaintext URLs', () => {
    expect(() => validateProviderBaseUrl('https://user:pass@example.test/v1')).toThrow();
    expect(() => validateProviderBaseUrl('http://example.test/v1')).toThrow();
  });

  it('rejects transport headers and classifies credential headers', () => {
    expect(() => validateCustomHeader('Host', 'example.test')).toThrow();
    expect(isSensitiveHeaderName('X-API-Key')).toBe(true);
    expect(isSensitiveHeaderName('X-Tenant')).toBe(false);
  });

  it('blocks private HTTPS targets while allowing explicit local HTTP', async () => {
    await expect(assertSafeProviderEndpoint('https://169.254.169.254/v1')).rejects.toThrow(
      /私网或保留地址/,
    );
    await expect(assertSafeProviderEndpoint('http://127.0.0.1:11434/v1')).resolves.toBeUndefined();
  });
});
