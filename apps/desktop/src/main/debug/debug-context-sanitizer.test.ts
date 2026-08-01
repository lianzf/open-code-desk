import { describe, expect, it } from 'vitest';

import { sanitizeDebugContextSection } from './debug-context-sanitizer';

describe('sanitizeDebugContextSection', () => {
  it('redacts before truncating and reports both outcomes', () => {
    const section = sanitizeDebugContextSection({
      key: 'console',
      title: '输出',
      content: `password=never-leak ${'x'.repeat(300)}`,
      maximumCharacters: 100,
    });

    expect(section.content).not.toContain('never-leak');
    expect(section.content).toContain('[REDACTED]');
    expect(section.redactionCount).toBe(1);
    expect(section.truncated).toBe(true);
    expect(section.content.length).toBeLessThanOrEqual(100);
  });
});
