import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolveNodeDebugAdapterPathInput {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly packaged: boolean;
  readonly fileExists?: (path: string) => boolean;
}

export function resolveNodeDebugAdapterServerPath(input: ResolveNodeDebugAdapterPathInput): string {
  if (input.packaged) {
    return join(input.resourcesPath, 'js-debug', 'src', 'dapDebugServer.js');
  }
  const relativeParts = ['vendor', 'js-debug-1.117.0', 'src', 'dapDebugServer.js'] as const;
  const candidates = [
    join(input.appPath, ...relativeParts),
    join(input.appPath, 'apps', 'desktop', ...relativeParts),
    join(input.appPath, '..', '..', ...relativeParts),
  ];
  const fileExists = input.fileExists ?? existsSync;
  return candidates.find((candidate) => fileExists(candidate)) ?? candidates[0] ?? '';
}
