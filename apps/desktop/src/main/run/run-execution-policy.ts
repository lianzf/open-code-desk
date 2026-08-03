import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';

import type {
  RunCommandSnapshot,
  RunEnvironmentVariable,
  RunRiskLevel,
} from '@open-code-desk/domain';

import { isPathInside, normalizeRelativePath, toPlatformPath } from '../filesystem/path-policy';
import type { StoredRunEnvironmentVariable } from '../database/schema';
import type { SecretStore } from '../security/secret-store';

const maximumEnvironmentFileBytes = 1024 * 1024;
const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export interface EnvironmentFileSnapshot {
  readonly digest: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface ResolvedRunEnvironment {
  readonly values: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
}

export interface StoredRunEnvironmentSource {
  readonly environmentVariables: ReadonlyArray<StoredRunEnvironmentVariable>;
  readonly environmentFile?: string;
}

export function publicEnvironmentVariables(
  configuration: StoredRunEnvironmentSource,
): ReadonlyArray<RunEnvironmentVariable> {
  return configuration.environmentVariables.map((variable) => ({
    name: variable.name,
    sensitive: variable.sensitive,
    configured: variable.configured,
    ...(!variable.sensitive && variable.value !== undefined ? { value: variable.value } : {}),
  }));
}

export async function resolveRunWorkingDirectory(
  workspaceRoot: string,
  requestedDirectory: string,
): Promise<string> {
  const relativePath = normalizeRelativePath(requestedDirectory);
  const candidate = toPlatformPath(workspaceRoot, relativePath);
  const canonical = await realpath(candidate);
  if (!isPathInside(workspaceRoot, canonical) || !(await stat(canonical)).isDirectory()) {
    throw new Error('运行工作目录不在当前工作区内，或该路径不是目录。');
  }
  return canonical;
}

export async function readEnvironmentFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<EnvironmentFileSnapshot> {
  const candidate = toPlatformPath(workspaceRoot, normalizeRelativePath(relativePath));
  const canonical = await realpath(candidate);
  const fileStat = await stat(canonical);
  if (!isPathInside(workspaceRoot, canonical) || !fileStat.isFile()) {
    throw new Error('环境变量文件不在当前工作区内，或该路径不是文件。');
  }
  if (fileStat.size > maximumEnvironmentFileBytes) {
    throw new Error('环境变量文件超过 1 MiB 安全限制。');
  }
  const content = await readFile(canonical);
  return {
    digest: createHash('sha256').update(content).digest('hex'),
    values: parseEnvironmentFile(content.toString('utf8')),
  };
}

export async function resolveRunEnvironment(
  workspaceRoot: string,
  configuration: StoredRunEnvironmentSource,
  secretStore: SecretStore,
  expectedEnvironmentFileDigest?: string,
): Promise<ResolvedRunEnvironment> {
  const fileSnapshot =
    configuration.environmentFile === undefined
      ? null
      : await readEnvironmentFile(workspaceRoot, configuration.environmentFile);
  if (
    expectedEnvironmentFileDigest !== undefined &&
    fileSnapshot?.digest !== expectedEnvironmentFileDigest
  ) {
    throw new Error('环境变量文件在批准前已发生变化，请重新审核运行请求。');
  }

  const values: Record<string, string> = { ...(fileSnapshot?.values ?? {}) };
  const sensitiveValues: string[] = [];
  for (const variable of configuration.environmentVariables) {
    if (!variable.configured) {
      continue;
    }
    if (!variable.sensitive) {
      if (variable.value !== undefined) {
        values[variable.name] = variable.value;
      }
      continue;
    }
    if (variable.secretRef === undefined) {
      throw new Error(`敏感环境变量 ${variable.name} 缺少安全凭据引用。`);
    }
    const value = await secretStore.get(variable.secretRef);
    if (value === null) {
      throw new Error(`敏感环境变量 ${variable.name} 的安全凭据不可用。`);
    }
    values[variable.name] = value;
    sensitiveValues.push(value);
  }
  return { values, sensitiveValues };
}

export function runApprovalDigest(input: {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly command: RunCommandSnapshot;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        executionId: input.executionId,
        workspaceId: input.workspaceId,
        command: input.command,
        riskLevel: input.riskLevel,
        riskReasons: input.riskReasons,
      }),
    )
    .digest('hex');
}

function parseEnvironmentFile(content: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [index, rawLine] of content
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const declaration = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separator = declaration.indexOf('=');
    if (separator <= 0) {
      throw new Error(`环境变量文件第 ${index + 1} 行格式无效。`);
    }
    const name = declaration.slice(0, separator).trim();
    if (!environmentNamePattern.test(name)) {
      throw new Error(`环境变量文件第 ${index + 1} 行的变量名无效。`);
    }
    const rawValue = declaration.slice(separator + 1).trim();
    const quoted =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")));
    const value = quoted ? rawValue.slice(1, -1) : rawValue.replace(/\s+#.*$/u, '').trimEnd();
    if (value.includes('\0')) {
      throw new Error(`环境变量文件第 ${index + 1} 行包含无效字符。`);
    }
    values[name] = value;
  }
  return values;
}
