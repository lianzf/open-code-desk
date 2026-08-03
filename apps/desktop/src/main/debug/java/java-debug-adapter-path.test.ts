import { describe, expect, it } from 'vitest';

import { resolveJavaDebugAdapterPaths } from './java-debug-adapter-path';

describe('Java debug adapter paths', () => {
  it('maps packaged resources', () => {
    expect(
      resolveJavaDebugAdapterPaths({
        appPath: 'app',
        resourcesPath: 'resources',
        packaged: true,
      }),
    ).toEqual({
      jdtLsRoot: expect.stringContaining('resources'),
      debugPluginPath: expect.stringContaining('com.microsoft.java.debug.plugin-0.53.2.jar'),
    });
  });

  it('finds the monorepo vendor directory in development', () => {
    const paths = resolveJavaDebugAdapterPaths({
      appPath: 'repo',
      resourcesPath: 'resources',
      packaged: false,
      fileExists: (path) =>
        path.replaceAll('\\', '/').includes('apps/desktop/vendor/java-debug-0.59.0'),
    });
    expect(paths.jdtLsRoot.replaceAll('\\', '/')).toContain('apps/desktop/vendor/jdtls-1.60.0');
  });
});
