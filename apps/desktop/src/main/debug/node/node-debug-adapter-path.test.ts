import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveNodeDebugAdapterServerPath } from './node-debug-adapter-path';

describe('resolveNodeDebugAdapterServerPath', () => {
  it('finds the vendored adapter when Electron treats the monorepo root as appPath', () => {
    const expected = join(
      'repository',
      'apps',
      'desktop',
      'vendor',
      'js-debug-1.117.0',
      'src',
      'dapDebugServer.js',
    );

    expect(
      resolveNodeDebugAdapterServerPath({
        appPath: 'repository',
        resourcesPath: 'resources',
        packaged: false,
        fileExists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });

  it('uses the packaged extraResources location without probing development paths', () => {
    expect(
      resolveNodeDebugAdapterServerPath({
        appPath: 'app',
        resourcesPath: 'resources',
        packaged: true,
      }),
    ).toBe(join('resources', 'js-debug', 'src', 'dapDebugServer.js'));
  });

  it('finds the adapter relative to an electron-vite out/main appPath', () => {
    const appPath = join('repository', 'apps', 'desktop', 'out', 'main');
    const expected = join(
      'repository',
      'apps',
      'desktop',
      'vendor',
      'js-debug-1.117.0',
      'src',
      'dapDebugServer.js',
    );

    expect(
      resolveNodeDebugAdapterServerPath({
        appPath,
        resourcesPath: 'resources',
        packaged: false,
        fileExists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });
});
