import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolveJavaDebugAdapterPathsInput {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly packaged: boolean;
  readonly fileExists?: (path: string) => boolean;
}

export interface JavaDebugAdapterPaths {
  readonly jdtLsRoot: string;
  readonly debugPluginPath: string;
}

const jdtLsVendorName = 'jdtls-1.60.0';
const javaDebugVendorName = 'java-debug-0.59.0';
const debugPluginName = 'com.microsoft.java.debug.plugin-0.53.2.jar';

export function resolveJavaDebugAdapterPaths(
  input: ResolveJavaDebugAdapterPathsInput,
): JavaDebugAdapterPaths {
  if (input.packaged) {
    return {
      jdtLsRoot: join(input.resourcesPath, 'jdtls'),
      debugPluginPath: join(input.resourcesPath, 'java-debug', debugPluginName),
    };
  }
  const roots = [
    input.appPath,
    join(input.appPath, 'apps', 'desktop'),
    join(input.appPath, '..', '..'),
  ];
  const fileExists = input.fileExists ?? existsSync;
  const selected =
    roots.find((root) => fileExists(join(root, 'vendor', javaDebugVendorName, debugPluginName))) ??
    roots[0] ??
    input.appPath;
  return {
    jdtLsRoot: join(selected, 'vendor', jdtLsVendorName),
    debugPluginPath: join(selected, 'vendor', javaDebugVendorName, debugPluginName),
  };
}
