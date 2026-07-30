import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isPathInside,
  isSensitiveRelativePath,
  normalizeRelativePath,
  toPlatformPath,
} from './path-policy';

describe('workspace path policy', () => {
  it('normalizes safe relative paths without changing their meaning', () => {
    expect(normalizeRelativePath('src\\features\\editor.ts')).toBe('src/features/editor.ts');
    expect(normalizeRelativePath('')).toBe('');
  });

  it.each(['../secret.txt', 'src/../../secret.txt', '/etc/passwd', 'C:\\Users\\secret'])(
    'rejects traversal or absolute path %s',
    (unsafePath) => {
      expect(() => normalizeRelativePath(unsafePath)).toThrow();
    },
  );

  it('does not mistake sibling paths with the same prefix for descendants', () => {
    const root = resolve('C:/workspace/project');
    expect(isPathInside(root, resolve(root, 'src/index.ts'))).toBe(true);
    expect(isPathInside(root, resolve(root, '../project-secrets/key.txt'))).toBe(false);
    expect(() => toPlatformPath(root, '../project-secrets/key.txt')).toThrow();
  });

  it.each(['.env', '.env.local', '.ssh/id_ed25519', 'certificates/client.p12'])(
    'classifies %s as sensitive',
    (sensitivePath) => {
      expect(isSensitiveRelativePath(sensitivePath)).toBe(true);
    },
  );
});
