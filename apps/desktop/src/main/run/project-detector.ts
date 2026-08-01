import { lstat, open, opendir } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

import type {
  ProjectDetection,
  ProjectDetectionEvidence,
  ProjectType,
  RunConfigurationDraft,
} from '@open-code-desk/domain';

interface PackageJsonShape {
  readonly main?: unknown;
  readonly scripts?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
}

const PACKAGE_JSON_LIMIT = 256 * 1024;
const TEXT_MARKER_LIMIT = 64 * 1024;
const ROOT_ENTRY_LIMIT = 512;

const fixedMarkers = `
package.json pnpm-lock.yaml yarn.lock package-lock.json bun.lock bun.lockb tsconfig.json
next.config.js next.config.mjs next.config.ts pom.xml mvnw mvnw.cmd build.gradle build.gradle.kts
settings.gradle settings.gradle.kts gradlew gradlew.bat requirements.txt pyproject.toml Pipfile
manage.py main.py app.py CMakeLists.txt Makefile main.c main.cc main.cpp main.cxx global.json
Directory.Build.props go.mod Cargo.toml run.sh start.sh run.ps1 start.ps1 run.cmd start.cmd
index.js index.mjs index.cjs server.js server.mjs server.cjs app.js app.mjs app.cjs
`
  .trim()
  .split(/\s+/u);

const primaryTypePriority: ReadonlyArray<ProjectType> = [
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

async function isRegularMarker(rootPath: string, relativePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(resolve(rootPath, relativePath));
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function existingFixedMarkers(rootPath: string): Promise<Set<string>> {
  const checks = await Promise.all(
    fixedMarkers.map(async (marker) => [marker, await isRegularMarker(rootPath, marker)] as const),
  );
  return new Set(checks.filter(([, exists]) => exists).map(([marker]) => marker));
}

async function boundedRootFileNames(rootPath: string): Promise<ReadonlyArray<string>> {
  const names: string[] = [];
  let directory;
  try {
    directory = await opendir(rootPath);
    for await (const entry of directory) {
      if (names.length >= ROOT_ENTRY_LIMIT) {
        break;
      }
      if (entry.isFile() && !entry.isSymbolicLink()) {
        names.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  return names;
}

async function readBoundedText(
  rootPath: string,
  relativePath: string,
  maximumBytes: number,
  requireComplete: boolean,
): Promise<string | undefined> {
  if (!(await isRegularMarker(rootPath, relativePath))) {
    return undefined;
  }

  let handle;
  try {
    handle = await open(resolve(rootPath, relativePath), 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || (requireComplete && metadata.size > maximumBytes)) {
      return undefined;
    }
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

function parsePackageJson(content: string | undefined): PackageJsonShape | undefined {
  if (content === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJsonShape) : undefined;
  } catch {
    return undefined;
  }
}

function objectKeys(value: unknown): ReadonlySet<string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return new Set();
  }
  return new Set(Object.keys(value));
}

function safePackageEntry(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) {
    return undefined;
  }
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

function packageManager(markers: ReadonlySet<string>): string {
  if (markers.has('pnpm-lock.yaml')) return 'pnpm';
  if (markers.has('yarn.lock')) return 'yarn';
  if (markers.has('bun.lock') || markers.has('bun.lockb')) return 'bun';
  return 'npm';
}

function uniqueDrafts(
  drafts: ReadonlyArray<RunConfigurationDraft>,
): ReadonlyArray<RunConfigurationDraft> {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = JSON.stringify([draft.executable, draft.args, draft.workingDirectory]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function detectProject(
  workspaceId: string,
  workspaceRoot: string,
): Promise<ProjectDetection> {
  const rootPath = resolve(workspaceRoot);
  const [markers, rootFileNames, packageContent, pomContent, gradleContent, cmakeContent] =
    await Promise.all([
      existingFixedMarkers(rootPath),
      boundedRootFileNames(rootPath),
      readBoundedText(rootPath, 'package.json', PACKAGE_JSON_LIMIT, true),
      readBoundedText(rootPath, 'pom.xml', TEXT_MARKER_LIMIT, false),
      Promise.all([
        readBoundedText(rootPath, 'build.gradle', TEXT_MARKER_LIMIT, false),
        readBoundedText(rootPath, 'build.gradle.kts', TEXT_MARKER_LIMIT, false),
      ]).then((contents) => contents.filter(Boolean).join('\n')),
      readBoundedText(rootPath, 'CMakeLists.txt', TEXT_MARKER_LIMIT, false),
    ]);

  const detected = new Set<ProjectType>();
  const evidence: ProjectDetectionEvidence[] = [];
  const drafts: RunConfigurationDraft[] = [];
  const addType = (projectType: ProjectType, marker: string) => {
    detected.add(projectType);
    if (!evidence.some((item) => item.path === marker)) {
      evidence.push({ path: marker, reason: `Detected ${projectType} project marker.` });
    }
  };
  const addDraft = (
    name: string,
    type: ProjectType,
    executable: string,
    args: ReadonlyArray<string>,
  ) =>
    drafts.push({
      workspaceId,
      name,
      type,
      executable,
      args,
      runtimeArgs: [],
      workingDirectory: '',
      environmentVariables: [],
      console: 'runOutput',
      autoGenerated: true,
    });

  const packageJson = parsePackageJson(packageContent);
  if (markers.has('package.json')) {
    addType('node', 'package.json');
    const dependencies = new Set([
      ...objectKeys(packageJson?.dependencies),
      ...objectKeys(packageJson?.devDependencies),
    ]);
    if (markers.has('tsconfig.json') || dependencies.has('typescript'))
      addType('typescript', 'tsconfig.json');
    if (dependencies.has('react')) addType('react', 'package.json#dependencies');
    if (dependencies.has('vue')) addType('vue', 'package.json#dependencies');
    if (
      dependencies.has('next') ||
      [...markers].some((marker) => marker.startsWith('next.config.'))
    ) {
      addType('nextjs', dependencies.has('next') ? 'package.json#dependencies' : 'next.config.*');
    }

    const manager = packageManager(markers);
    const scripts = objectKeys(packageJson?.scripts);
    for (const script of [...scripts].sort().slice(0, 100)) {
      if (/^[a-z0-9][a-z0-9:_-]{0,99}$/iu.test(script)) {
        addDraft(`package.json · ${script}`, 'node', manager, ['run', script]);
      }
    }
    const mainEntry = safePackageEntry(packageJson?.main);
    if (mainEntry !== undefined) {
      addDraft(`Node · ${mainEntry}`, 'node', 'node', [mainEntry]);
    }
  } else if (markers.has('tsconfig.json')) {
    addType('typescript', 'tsconfig.json');
  }

  const fixedNodeEntry = [
    'index.js',
    'index.mjs',
    'index.cjs',
    'server.js',
    'server.mjs',
    'server.cjs',
    'app.js',
    'app.mjs',
    'app.cjs',
  ].find((entry) => markers.has(entry));
  if (fixedNodeEntry !== undefined) {
    addType('node', fixedNodeEntry);
    addDraft(`Node · ${fixedNodeEntry}`, 'node', 'node', [fixedNodeEntry]);
  }

  if (markers.has('pom.xml')) {
    addType('java-maven', 'pom.xml');
    const spring = /spring-boot/iu.test(pomContent ?? '');
    if (spring) addType('spring-boot', 'pom.xml');
    const command = markers.has(process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw')
      ? process.platform === 'win32'
        ? '.\\mvnw.cmd'
        : './mvnw'
      : 'mvn';
    addDraft(
      spring ? 'Spring Boot · Maven' : 'Maven · test',
      spring ? 'spring-boot' : 'java-maven',
      command,
      [spring ? 'spring-boot:run' : 'test'],
    );
  }

  const hasGradle = markers.has('build.gradle') || markers.has('build.gradle.kts');
  if (hasGradle) {
    addType('java-gradle', markers.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle');
    const spring = /org\.springframework\.boot|spring-boot/iu.test(gradleContent);
    if (spring) addType('spring-boot', 'build.gradle*');
    const nativeWrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
    const command = markers.has(nativeWrapper)
      ? process.platform === 'win32'
        ? '.\\gradlew.bat'
        : './gradlew'
      : 'gradle';
    addDraft(
      spring ? 'Spring Boot · Gradle' : 'Gradle · test',
      spring ? 'spring-boot' : 'java-gradle',
      command,
      [spring ? 'bootRun' : 'test'],
    );
  }

  const pythonMarker = [
    'manage.py',
    'main.py',
    'app.py',
    'pyproject.toml',
    'requirements.txt',
    'Pipfile',
  ].find((marker) => markers.has(marker));
  if (pythonMarker !== undefined) {
    addType('python', pythonMarker);
    const entry = ['manage.py', 'main.py', 'app.py'].find((marker) => markers.has(marker));
    if (entry !== undefined) {
      addDraft(
        `Python · ${entry}`,
        'python',
        process.platform === 'win32' ? 'python' : 'python3',
        entry === 'manage.py' ? [entry, 'runserver'] : [entry],
      );
    }
  }

  if (markers.has('main.c') || /(?:LANGUAGES\s+[^\n)]*\bC\b|\.c\b)/iu.test(cmakeContent ?? ''))
    addType('c', markers.has('main.c') ? 'main.c' : 'CMakeLists.txt');
  const cppMarker = ['main.cc', 'main.cpp', 'main.cxx'].find((marker) => markers.has(marker));
  if (cppMarker !== undefined || /(?:\bCXX\b|\.c(?:c|pp|xx)\b)/iu.test(cmakeContent ?? ''))
    addType('cpp', cppMarker ?? 'CMakeLists.txt');
  if (markers.has('CMakeLists.txt')) {
    addDraft('CMake · configure', detected.has('cpp') ? 'cpp' : 'c', 'cmake', [
      '-S',
      '.',
      '-B',
      'build',
    ]);
    addDraft('CMake · build', detected.has('cpp') ? 'cpp' : 'c', 'cmake', ['--build', 'build']);
  } else if (markers.has('Makefile') && (detected.has('c') || detected.has('cpp'))) {
    addDraft('Make · build', detected.has('cpp') ? 'cpp' : 'c', 'make', []);
  }

  const dotnetProject = rootFileNames.find((name) =>
    ['.sln', '.csproj', '.fsproj', '.vbproj'].includes(extname(name).toLocaleLowerCase('en-US')),
  );
  if (
    dotnetProject !== undefined ||
    markers.has('global.json') ||
    markers.has('Directory.Build.props')
  ) {
    addType(
      'dotnet',
      dotnetProject ?? (markers.has('global.json') ? 'global.json' : 'Directory.Build.props'),
    );
    addDraft(
      '.NET · run',
      'dotnet',
      'dotnet',
      dotnetProject !== undefined && extname(dotnetProject).toLocaleLowerCase('en-US') !== '.sln'
        ? ['run', '--project', dotnetProject]
        : ['run'],
    );
  }

  if (markers.has('go.mod')) {
    addType('go', 'go.mod');
    addDraft('Go · run', 'go', 'go', ['run', '.']);
  }
  if (markers.has('Cargo.toml')) {
    addType('rust', 'Cargo.toml');
    addDraft('Cargo · run', 'rust', 'cargo', ['run']);
  }

  const scriptMarker = ['run.sh', 'start.sh', 'run.ps1', 'start.ps1', 'run.cmd', 'start.cmd'].find(
    (marker) => markers.has(marker),
  );
  if (scriptMarker !== undefined) {
    addType('script', scriptMarker);
    if (scriptMarker.endsWith('.sh'))
      addDraft(`Script · ${scriptMarker}`, 'script', 'sh', [scriptMarker]);
    else if (scriptMarker.endsWith('.ps1'))
      addDraft(`Script · ${scriptMarker}`, 'script', 'pwsh', ['-File', scriptMarker]);
    else addDraft(`Script · ${scriptMarker}`, 'script', scriptMarker, []);
  }

  const detectedTypes = primaryTypePriority.filter((type) => detected.has(type));
  const primaryType = detectedTypes[0] ?? 'custom';
  return {
    workspaceId,
    primaryType,
    detectedTypes: detectedTypes.length === 0 ? ['custom'] : detectedTypes,
    evidence:
      detectedTypes.length === 0
        ? [{ path: '', reason: 'No supported root project marker was found.' }]
        : evidence,
    suggestedConfigurations: uniqueDrafts(drafts),
  };
}
