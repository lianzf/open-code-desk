import { lstat, open, opendir } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

import type { ProjectType, RunConfigurationDraft } from '@open-code-desk/domain';

interface PackageJsonShape {
  readonly main?: unknown;
  readonly scripts?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
}

export const PACKAGE_JSON_LIMIT = 256 * 1024;
export const TEXT_MARKER_LIMIT = 64 * 1024;
const ROOT_ENTRY_LIMIT = 512;

const fixedMarkers = `
package.json pnpm-lock.yaml yarn.lock package-lock.json bun.lock bun.lockb tsconfig.json
next.config.js next.config.mjs next.config.ts pom.xml mvnw mvnw.cmd build.gradle build.gradle.kts
settings.gradle settings.gradle.kts gradlew gradlew.bat requirements.txt pyproject.toml Pipfile
pytest.ini manage.py main.py app.py CMakeLists.txt Makefile main.c main.cc main.cpp main.cxx global.json
Directory.Build.props go.mod Cargo.toml run.sh start.sh run.ps1 start.ps1 run.cmd start.cmd
index.js index.mjs index.cjs server.js server.mjs server.cjs app.js app.mjs app.cjs
`
  .trim()
  .split(/\s+/u);

export const primaryTypePriority: ReadonlyArray<ProjectType> = [
  'electron',
  'nextjs',
  'react',
  'vue',
  'spring-boot',
  'java-maven',
  'java-gradle',
  'typescript',
  'node',
  'python',
  'cpp',
  'c',
  'dotnet',
  'go',
  'rust',
  'script',
];

export function expectedElectronExecutable(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const distributionRoot = resolve(rootPath, 'node_modules', 'electron', 'dist');
  if (platform === 'win32') return resolve(distributionRoot, 'electron.exe');
  if (platform === 'darwin') {
    return resolve(distributionRoot, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return resolve(distributionRoot, 'electron');
}

async function isRegularMarker(rootPath: string, relativePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(resolve(rootPath, relativePath));
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function existingFixedMarkers(rootPath: string): Promise<Set<string>> {
  const checks = await Promise.all(
    fixedMarkers.map(async (marker) => [marker, await isRegularMarker(rootPath, marker)] as const),
  );
  return new Set(checks.filter(([, exists]) => exists).map(([marker]) => marker));
}

export async function boundedRootFileNames(rootPath: string): Promise<ReadonlyArray<string>> {
  const names: string[] = [];
  let directory;
  try {
    directory = await opendir(rootPath);
    for await (const entry of directory) {
      if (names.length >= ROOT_ENTRY_LIMIT) break;
      if (entry.isFile() && !entry.isSymbolicLink()) names.push(entry.name);
    }
  } catch {
    return [];
  }
  return names;
}

export async function readBoundedText(
  rootPath: string,
  relativePath: string,
  maximumBytes: number,
  requireComplete: boolean,
): Promise<string | undefined> {
  if (!(await isRegularMarker(rootPath, relativePath))) return undefined;
  let handle;
  try {
    handle = await open(resolve(rootPath, relativePath), 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || (requireComplete && metadata.size > maximumBytes)) return undefined;
    const bytesToRead = Math.min(metadata.size, maximumBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function parsePackageJson(content: string | undefined): PackageJsonShape | undefined {
  if (content === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJsonShape) : undefined;
  } catch {
    return undefined;
  }
}

export function objectKeys(value: unknown): ReadonlySet<string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
}

export function packageScript(value: unknown, name: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const script = (value as Readonly<Record<string, unknown>>)[name];
  return typeof script === 'string' && script.length <= 4_096 ? script : undefined;
}

export function safePackageEntry(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) return undefined;
  const normalized = value.replaceAll('\\', '/');
  if (
    isAbsolute(normalized) ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => segment === '..') ||
    !['.js', '.mjs', '.cjs'].includes(extname(normalized).toLocaleLowerCase('en-US'))
  ) {
    return undefined;
  }
  return normalized.replace(/^\.\//u, '');
}

export function packageManager(markers: ReadonlySet<string>): string {
  if (markers.has('pnpm-lock.yaml')) return 'pnpm';
  if (markers.has('yarn.lock')) return 'yarn';
  if (markers.has('bun.lock') || markers.has('bun.lockb')) return 'bun';
  return 'npm';
}

export function uniqueDrafts(
  drafts: ReadonlyArray<RunConfigurationDraft>,
): ReadonlyArray<RunConfigurationDraft> {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = JSON.stringify([
      draft.executable,
      draft.runtimeArgs,
      draft.args,
      draft.workingDirectory,
      draft.port,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
