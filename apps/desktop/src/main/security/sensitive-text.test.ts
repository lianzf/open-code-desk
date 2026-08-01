import { describe, expect, it } from 'vitest';

import { isSensitiveName, redactSensitiveText } from './sensitive-text';

describe('redactSensitiveText', () => {
  it('redacts exact runtime secrets and credential-shaped text', () => {
    const source = 'password=database-secret Bearer token-value sk-example-secret-value';
    const redacted = redactSensitiveText(source, ['database-secret']);

    expect(redacted).toBe('password=[REDACTED] Bearer [REDACTED] [REDACTED]');
    expect(redacted).not.toContain('database-secret');
    expect(redacted).not.toContain('token-value');
  });

  it('redacts credential assignments and passwords embedded in URLs', () => {
    const source = [
      'apiKey = plain-value',
      '"password": "json-value"',
      'DATABASE_URL=postgres://user:database-value@localhost/app',
    ].join('\n');
    const redacted = redactSensitiveText(source);

    expect(redacted).not.toMatch(/plain-value|json-value|database-value/u);
    expect(redacted).toContain('apiKey = [REDACTED]');
    expect(redacted).toContain('DATABASE_URL=[REDACTED]');
  });

  it('recognizes debugger variable names without treating token estimates as secrets', () => {
    expect(isSensitiveName('database_password')).toBe(true);
    expect(isSensitiveName('auth.token')).toBe(true);
    expect(isSensitiveName('tokenEstimate')).toBe(false);
  });
});
