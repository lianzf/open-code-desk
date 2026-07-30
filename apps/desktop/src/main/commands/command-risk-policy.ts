import { basename, isAbsolute, parse, resolve } from 'node:path';

import type { CommandRiskLevel, PermissionRule } from '@open-code-desk/domain';

export interface CommandRiskAssessment {
  readonly level: CommandRiskLevel;
  readonly reasons: ReadonlyArray<string>;
  readonly networkAccess: boolean;
}

export interface ExecutableRuleValue {
  readonly executable: string;
  readonly cwd: string;
}

const blockedExecutables = new Set([
  'bcdedit',
  'diskpart',
  'format',
  'halt',
  'pkexec',
  'poweroff',
  'reboot',
  'runas',
  'shutdown',
  'su',
  'sudo',
]);

const shellExecutables = new Set([
  'bash',
  'cmd',
  'command',
  'fish',
  'powershell',
  'pwsh',
  'sh',
  'wsl',
  'zsh',
]);

const destructiveExecutables = new Set(['del', 'erase', 'rd', 'remove-item', 'rmdir', 'rm']);

const networkExecutables = new Set([
  'curl',
  'ftp',
  'git',
  'invoke-webrequest',
  'npm',
  'npx',
  'pip',
  'pip3',
  'pnpm',
  'scp',
  'ssh',
  'wget',
  'yarn',
]);

const packageManagerExecutables = new Set([
  'bun',
  'cargo',
  'composer',
  'dotnet',
  'go',
  'gradle',
  'maven',
  'npm',
  'npx',
  'pip',
  'pip3',
  'pnpm',
  'yarn',
]);

export function normalizedExecutableName(executable: string): string {
  return basename(executable)
    .toLocaleLowerCase('en-US')
    .replace(/\.(?:bat|cmd|com|exe)$/u, '');
}

function referencesWorkspaceRoot(argument: string, cwd: string, workspaceRoot: string): boolean {
  if (argument === '.' || argument === './' || argument === '.\\') {
    return resolve(cwd) === resolve(workspaceRoot);
  }
  if (!isAbsolute(argument)) {
    return false;
  }
  const resolved = resolve(argument);
  return resolved === resolve(workspaceRoot) || resolved === parse(resolved).root;
}

function includesRecursiveForce(args: ReadonlyArray<string>): boolean {
  const normalized = args.map((argument) => argument.toLocaleLowerCase('en-US'));
  return (
    normalized.some((argument) => /^-[a-z]*r[a-z]*f[a-z]*$/u.test(argument)) ||
    (normalized.includes('-recurse') && normalized.includes('-force')) ||
    normalized.includes('/s')
  );
}

export function assessCommandRisk(input: {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly workspaceRoot: string;
}): CommandRiskAssessment {
  const executableName = normalizedExecutableName(input.executable);
  const normalizedArgs = input.args.map((argument) => argument.toLocaleLowerCase('en-US'));
  const reasons: string[] = [];
  let level: CommandRiskLevel = 'low';

  if (blockedExecutables.has(executableName)) {
    return {
      level: 'blocked',
      reasons: [`${executableName} is a privileged or system-control executable.`],
      networkAccess: false,
    };
  }

  if (
    (executableName === 'powershell' || executableName === 'pwsh') &&
    normalizedArgs.some((argument) => ['-e', '-ec', '-enc', '-encodedcommand'].includes(argument))
  ) {
    return {
      level: 'blocked',
      reasons: ['Encoded PowerShell commands are not allowed.'],
      networkAccess: false,
    };
  }

  if (destructiveExecutables.has(executableName)) {
    level = 'high';
    reasons.push('The executable can delete files.');
    if (
      includesRecursiveForce(input.args) &&
      input.args.some((argument) =>
        referencesWorkspaceRoot(argument, input.cwd, input.workspaceRoot),
      )
    ) {
      return {
        level: 'blocked',
        reasons: ['Recursive deletion of the workspace root or a filesystem root is blocked.'],
        networkAccess: false,
      };
    }
  }

  if (shellExecutables.has(executableName)) {
    level = 'high';
    reasons.push('A command interpreter can execute compound or redirected commands.');
    const joined = normalizedArgs.join(' ');
    if (
      normalizedArgs.some((argument) => ['-c', '/c', '-command'].includes(argument)) &&
      /(?:curl|wget|invoke-webrequest).*(?:\||iex|invoke-expression|sh|bash|powershell)/u.test(
        joined,
      )
    ) {
      return {
        level: 'blocked',
        reasons: ['Downloading and immediately executing remote content is blocked.'],
        networkAccess: true,
      };
    }
  }

  const networkAccess = networkExecutables.has(executableName);
  if (networkAccess) {
    if (level === 'low') {
      level = 'medium';
    }
    reasons.push('This executable may access the network.');
  }

  if (packageManagerExecutables.has(executableName)) {
    if (level === 'low') {
      level = 'medium';
    }
    reasons.push('Package manager commands may execute project lifecycle scripts.');
  }

  if (reasons.length === 0) {
    reasons.push('No known high-risk pattern was detected; explicit approval is still required.');
  }
  return { level, reasons, networkAccess };
}

export function executableRuleValue(executable: string, cwd: string): string {
  return JSON.stringify({
    executable: executable.toLocaleLowerCase('en-US'),
    cwd: resolve(cwd).toLocaleLowerCase('en-US'),
  });
}

export function matchesExecutableRule(
  rule: PermissionRule,
  executable: string,
  cwd: string,
): boolean {
  try {
    const parsed = JSON.parse(rule.value) as Partial<ExecutableRuleValue>;
    return (
      parsed.executable === executable.toLocaleLowerCase('en-US') &&
      parsed.cwd === resolve(cwd).toLocaleLowerCase('en-US')
    );
  } catch {
    return false;
  }
}
