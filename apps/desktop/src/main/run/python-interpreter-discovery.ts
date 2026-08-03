import { open, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';

import type { RuntimeCandidate, RuntimeCandidateSource } from '@open-code-desk/domain';
import type { AppSettings } from '@open-code-desk/ipc-contracts';

const PYVENV_CONFIG_LIMIT = 32 * 1024;

export interface PythonInterpreterDiscoveryOptions {
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly locale?: AppSettings['locale'];
  readonly platform?: NodeJS.Platform;
}

interface CandidateDraft {
  readonly executable: string;
  readonly label: string;
  readonly source: RuntimeCandidateSource;
  readonly versionConfigPath?: string;
  readonly reason: string;
}

export async function discoverPythonInterpreters(
  workspaceRoot: string,
  options: PythonInterpreterDiscoveryOptions = {},
): Promise<ReadonlyArray<RuntimeCandidate>> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const locale = options.locale ?? 'zh-CN';
  const root = resolve(workspaceRoot);
  const drafts = [
    ...workspaceCandidates(root, platform, locale),
    ...activeEnvironmentCandidates(environment, platform, locale),
    ...pathCandidates(environment, platform, locale),
  ];
  const seen = new Set<string>();
  const uniqueDrafts = drafts.filter((draft) => {
    const normalized = normalize(draft.executable);
    const key = platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const checked = await Promise.all(
    uniqueDrafts.slice(0, 100).map(async (draft) => {
      if (!(await isFile(draft.executable))) return undefined;
      const version =
        draft.versionConfigPath === undefined
          ? undefined
          : await readPyvenvVersion(draft.versionConfigPath);
      return { draft, version };
    }),
  );
  const discovered: RuntimeCandidate[] = checked.flatMap((result) =>
    result === undefined
      ? []
      : [
          {
            kind: 'python',
            executable: result.draft.executable,
            label: result.draft.label,
            source: result.draft.source,
            available: true,
            recommended: false,
            ...(result.version === undefined ? {} : { version: result.version }),
            reason: result.draft.reason,
          },
        ],
  );
  if (discovered[0] !== undefined) discovered[0] = { ...discovered[0], recommended: true };

  if (discovered.length > 0) return discovered;
  const fallback = platform === 'win32' ? 'python' : 'python3';
  return [
    {
      kind: 'python',
      executable: fallback,
      label: locale === 'zh-CN' ? `${fallback}（尚未验证）` : `${fallback} (not yet verified)`,
      source: 'fallback',
      available: false,
      recommended: true,
      reason:
        locale === 'zh-CN'
          ? '未在工作区虚拟环境或 PATH 中发现解释器；启动前会给出可操作的校验结果。'
          : 'No interpreter was found in a workspace virtual environment or on PATH; an actionable validation result will be shown before launch.',
    },
  ];
}

function workspaceCandidates(
  root: string,
  platform: NodeJS.Platform,
  locale: AppSettings['locale'],
): ReadonlyArray<CandidateDraft> {
  return ['.venv', 'venv', 'env'].map((directory) => ({
    executable: interpreterPath(join(root, directory), platform),
    label: locale === 'zh-CN' ? `${directory} 虚拟环境` : `${directory} virtual environment`,
    source: 'workspace-venv',
    versionConfigPath: join(root, directory, 'pyvenv.cfg'),
    reason:
      locale === 'zh-CN'
        ? '工作区内的虚拟环境优先，可减少依赖和解释器不一致。'
        : 'Workspace virtual environments are preferred to reduce dependency and interpreter mismatches.',
  }));
}

function activeEnvironmentCandidates(
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  locale: AppSettings['locale'],
): ReadonlyArray<CandidateDraft> {
  const prefixes = [
    ['VIRTUAL_ENV', environmentValue(environment, 'VIRTUAL_ENV')],
    ['CONDA_PREFIX', environmentValue(environment, 'CONDA_PREFIX')],
  ] as const;
  return prefixes.flatMap(([name, prefix]) =>
    prefix === undefined || prefix.trim() === ''
      ? []
      : [
          {
            executable: interpreterPath(prefix, platform),
            label: locale === 'zh-CN' ? `${name} 当前环境` : `${name} active environment`,
            source: 'active-environment' as const,
            versionConfigPath: join(prefix, 'pyvenv.cfg'),
            reason:
              locale === 'zh-CN'
                ? `继承桌面进程的 ${name}，适合从已激活环境启动。`
                : `Uses ${name} inherited by the desktop process; suitable when launching from an activated environment.`,
          },
        ],
  );
}

function pathCandidates(
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  locale: AppSettings['locale'],
): ReadonlyArray<CandidateDraft> {
  const pathValue = environmentValue(environment, 'PATH') ?? '';
  const executableNames =
    platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];
  return pathValue
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
    .filter((entry) => entry !== '')
    .flatMap((entry) =>
      executableNames.map((name) => ({
        executable: join(entry, name),
        label: locale === 'zh-CN' ? `${name}（PATH）` : `${name} (PATH)`,
        source: 'path' as const,
        reason:
          locale === 'zh-CN'
            ? '系统 PATH 中发现的解释器。'
            : 'Interpreter discovered on the system PATH.',
      })),
    );
}

function interpreterPath(prefix: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? join(prefix, 'Scripts', 'python.exe')
    : join(prefix, 'bin', 'python');
}

function environmentValue(
  environment: Readonly<NodeJS.ProcessEnv>,
  requestedName: string,
): string | undefined {
  const match = Object.entries(environment).find(
    ([name]) => name.toLocaleLowerCase('en-US') === requestedName.toLocaleLowerCase('en-US'),
  );
  return match?.[1];
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

async function readPyvenvVersion(path: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > PYVENV_CONFIG_LIMIT) return undefined;
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    const match = /^version(?:_info)?\s*=\s*([^\r\n]+)$/imu.exec(
      buffer.subarray(0, bytesRead).toString('utf8'),
    );
    return match?.[1]?.trim();
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
