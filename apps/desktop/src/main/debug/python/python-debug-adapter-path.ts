import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolvePythonDebugAdapterPathInput {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly packaged: boolean;
  readonly fileExists?: (path: string) => boolean;
}

export function resolvePythonDebugAdapterPath(input: ResolvePythonDebugAdapterPathInput): string {
  if (input.packaged) return join(input.resourcesPath, 'debugpy', 'debugpy', 'adapter');
  const relativeParts = ['vendor', 'debugpy-1.8.21', 'debugpy', 'adapter'] as const;
  const candidates = [
    join(input.appPath, ...relativeParts),
    join(input.appPath, 'apps', 'desktop', ...relativeParts),
    join(input.appPath, '..', '..', ...relativeParts),
  ];
  const fileExists = input.fileExists ?? existsSync;
  return (
    candidates.find((candidate) => fileExists(join(candidate, '__main__.py'))) ??
    candidates[0] ??
    ''
  );
}
