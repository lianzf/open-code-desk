import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePythonDebugAdapterPath } from './python-debug-adapter-path';

describe('resolvePythonDebugAdapterPath', () => {
  it('finds vendored debugpy from the monorepo app path', () => {
    const expected = join(
      'repository',
      'apps',
      'desktop',
      'vendor',
      'debugpy-1.8.21',
      'debugpy',
      'adapter',
    );
    expect(
      resolvePythonDebugAdapterPath({
        appPath: 'repository',
        resourcesPath: 'resources',
        packaged: false,
        fileExists: (candidate) => candidate === join(expected, '__main__.py'),
      }),
    ).toBe(expected);
  });

  it('uses the packaged extraResources location', () => {
    expect(
      resolvePythonDebugAdapterPath({
        appPath: 'app',
        resourcesPath: 'resources',
        packaged: true,
      }),
    ).toBe(join('resources', 'debugpy', 'debugpy', 'adapter'));
  });
});
