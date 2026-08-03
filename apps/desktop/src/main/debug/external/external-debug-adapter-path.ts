import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function findDebugAdapterExecutable(
  candidates: ReadonlyArray<string>,
  options: {
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly platform?: NodeJS.Platform;
  } = {},
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const pathValue = environmentValue(environment, 'PATH') ?? '';
  const searchRoots = pathValue
    .split(delimiterForPlatform(platform))
    .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
    .filter((entry) => entry !== '');

  for (const candidate of candidates) {
    const paths = isAbsolute(candidate)
      ? [candidate]
      : candidate.includes('/') || candidate.includes('\\')
        ? [candidate]
        : searchRoots.flatMap((root) =>
            executableNames(candidate, platform).map((name) => join(root, name)),
          );
    for (const path of paths) {
      if ((await stat(path).catch(() => null))?.isFile() === true) return path;
    }
  }
  return undefined;
}

function executableNames(candidate: string, platform: NodeJS.Platform): ReadonlyArray<string> {
  if (platform !== 'win32' || /\.[a-z0-9]+$/iu.test(candidate)) return [candidate];
  return [`${candidate}.exe`, `${candidate}.com`];
}

function delimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

function environmentValue(
  environment: Readonly<NodeJS.ProcessEnv>,
  requestedName: string,
): string | undefined {
  return Object.entries(environment).find(
    ([name]) => name.toLocaleLowerCase('en-US') === requestedName.toLocaleLowerCase('en-US'),
  )?.[1];
}
