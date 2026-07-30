import { describe, expect, it } from 'vitest';

import { applyChangePatch, createChangeDiff } from './change-diff';

describe('change diff', () => {
  it('creates a unified diff with workspace paths', () => {
    const diff = createChangeDiff(
      'update',
      'src/example.ts',
      'const value = 1;\n',
      'const value = 2;\n',
    );
    expect(diff).toContain('a/src/example.ts');
    expect(diff).toContain('b/src/example.ts');
    expect(diff).toContain('-const value = 1;');
    expect(diff).toContain('+const value = 2;');
  });

  it('applies a clean unified patch and rejects a conflicting patch', () => {
    const patch = createChangeDiff('update', 'a.txt', 'before\n', 'after\n');
    expect(applyChangePatch('before\n', patch)).toBe('after\n');
    expect(() => applyChangePatch('changed\n', patch)).toThrow(/does not apply cleanly/);
  });
});
