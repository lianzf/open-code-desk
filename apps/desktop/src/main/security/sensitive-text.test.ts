import { describe, expect, it } from 'vitest';

import { redactSensitiveText } from './sensitive-text';

describe('redactSensitiveText', () => {
  it('redacts exact runtime secrets and credential-shaped text', () => {
    const source = 'password=database-secret Bearer token-value sk-example-secret-value';
    const redacted = redactSensitiveText(source, ['database-secret']);

    expect(redacted).toBe('password=[REDACTED] Bearer [REDACTED] [REDACTED]');
    expect(redacted).not.toContain('database-secret');
    expect(redacted).not.toContain('token-value');
  });
});
