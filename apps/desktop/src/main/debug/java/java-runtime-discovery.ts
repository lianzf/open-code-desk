import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

export interface JavaRuntimeDiscoveryOptions {
  readonly executableCandidates?: ReadonlyArray<string>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
}

export interface JavaRuntime {
  readonly executable: string;
  readonly majorVersion: number;
}

export async function findJavaRuntime(
  options: JavaRuntimeDiscoveryOptions = {},
): Promise<JavaRuntime | undefined> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'java.exe' : 'java';
  const candidates = new Set<string>(options.executableCandidates ?? []);
  for (const homeName of ['JDTLS_JAVA_HOME', 'JAVA_HOME'] as const) {
    const home = environment[homeName];
    if (home !== undefined && home.trim() !== '') candidates.add(join(home, 'bin', executableName));
  }
  for (const entry of (environment.PATH ?? '').split(delimiter).filter((value) => value !== '')) {
    candidates.add(join(entry, executableName));
  }
  if (platform === 'win32') {
    for (const root of windowsJdkRoots(environment)) {
      for (const directory of await readdir(root).catch(() => [])) {
        candidates.add(join(root, directory, 'bin', executableName));
      }
    }
  }
  for (const candidate of candidates) {
    const executable = resolve(candidate);
    if ((await stat(executable).catch(() => null))?.isFile() !== true) continue;
    const majorVersion = await javaMajorVersion(executable);
    if (majorVersion !== undefined && majorVersion >= 21) return { executable, majorVersion };
  }
  return undefined;
}

function windowsJdkRoots(environment: Readonly<NodeJS.ProcessEnv>): ReadonlyArray<string> {
  const roots: string[] = [];
  const userProfile = environment.USERPROFILE;
  if (userProfile !== undefined) roots.push(join(userProfile, '.jdks'));
  for (const programFilesName of ['ProgramFiles', 'ProgramFiles(x86)'] as const) {
    const programFiles = environment[programFilesName];
    if (programFiles === undefined) continue;
    roots.push(join(programFiles, 'Microsoft', 'jdk'));
    roots.push(join(programFiles, 'Eclipse Adoptium'));
    roots.push(join(programFiles, 'Java'));
  }
  return roots;
}

export function javaMajorVersion(
  executable: string,
  timeoutMs = 5_000,
): Promise<number | undefined> {
  return new Promise((resolveVersion) => {
    const child = spawn(executable, ['-version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const append = (chunk: Buffer | string) => {
      output = `${output}${chunk.toString()}`.slice(-4_096);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      child.kill();
      resolveVersion(undefined);
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      resolveVersion(undefined);
    });
    child.once('close', () => {
      clearTimeout(timer);
      const match = /version\s+"(?:1\.)?(\d+)/iu.exec(output);
      resolveVersion(match?.[1] === undefined ? undefined : Number(match[1]));
    });
  });
}
