import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

const retainedOutputTailBytes = 64 * 1024;

export interface StructuredSpawnCommand {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

const packageManagerCliCandidates: Readonly<Record<string, ReadonlyArray<string>>> = {
  npm: ['node_modules/npm/bin/npm-cli.js'],
  npx: ['node_modules/npm/bin/npx-cli.js'],
  pnpm: ['node_modules/corepack/dist/pnpm.js', 'node_modules/pnpm/bin/pnpm.cjs'],
  yarn: ['node_modules/corepack/dist/yarn.js', 'node_modules/yarn/bin/yarn.js'],
};

export async function resolveStructuredSpawnCommand(
  executable: string,
  args: ReadonlyArray<string>,
): Promise<StructuredSpawnCommand> {
  if (process.platform !== 'win32') {
    return { executable, args };
  }
  const commandName = basename(executable)
    .toLocaleLowerCase('en-US')
    .replace(/\.cmd$/u, '');
  const candidates = packageManagerCliCandidates[commandName];
  if (candidates === undefined) {
    return { executable, args };
  }
  const searchRoots = isAbsolute(executable)
    ? [dirname(executable)]
    : (process.env.Path ?? process.env.PATH ?? '')
        .split(';')
        .map((entry) => entry.replace(/^"|"$/gu, '').trim())
        .filter((entry) => entry !== '');
  for (const root of searchRoots) {
    const shim = isAbsolute(executable) ? executable : join(root, `${commandName}.cmd`);
    if (!(await isFile(shim))) {
      continue;
    }
    const nodeExecutable = join(root, 'node.exe');
    if (!(await isFile(nodeExecutable))) {
      continue;
    }
    for (const relativeCli of candidates) {
      const cli = join(root, ...relativeCli.split('/'));
      if (await isFile(cli)) {
        return { executable: nodeExecutable, args: [cli, ...args] };
      }
    }
  }
  return { executable, args };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export class StreamingSecretRedactor {
  readonly #secrets: ReadonlyArray<string>;
  readonly #maximumSecretLength: number;
  #pending = '';

  public constructor(values: ReadonlyArray<string>) {
    this.#secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
      (left, right) => right.length - left.length,
    );
    this.#maximumSecretLength = this.#secrets.reduce(
      (maximum, value) => Math.max(maximum, value.length),
      0,
    );
  }

  public push(chunk: string): string {
    this.#pending += chunk;
    if (this.#maximumSecretLength === 0) {
      const output = this.#pending;
      this.#pending = '';
      return output;
    }
    return this.consume(Math.max(0, this.#pending.length - this.#maximumSecretLength + 1));
  }

  public flush(): string {
    return this.consume(this.#pending.length);
  }

  private consume(minimumCharacters: number): string {
    let cursor = 0;
    let output = '';
    while (cursor < minimumCharacters) {
      const secret = this.#secrets.find((candidate) => this.#pending.startsWith(candidate, cursor));
      if (secret !== undefined) {
        output += '[REDACTED]';
        cursor += secret.length;
      } else {
        output += this.#pending[cursor];
        cursor += 1;
      }
    }
    this.#pending = this.#pending.slice(cursor);
    return output;
  }
}

export function minimalRunEnvironment(
  resolvedEnvironment: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const allowedNames =
    process.platform === 'win32'
      ? [
          'HOMEDRIVE',
          'HOMEPATH',
          'LOCALAPPDATA',
          'Path',
          'PATH',
          'PATHEXT',
          'SYSTEMROOT',
          'TEMP',
          'TMP',
          'USERPROFILE',
          'WINDIR',
        ]
      : ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER'];
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    allowedNames.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

  for (const [name, value] of Object.entries(resolvedEnvironment)) {
    if (process.platform === 'win32') {
      const duplicate = Object.keys(environment).find(
        (existingName) => existingName.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (duplicate !== undefined) {
        delete environment[duplicate];
      }
    }
    environment[name] = value;
  }
  return environment;
}

export function appendRetainedOutputTail(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.byteLength >= retainedOutputTailBytes) {
    return chunk.subarray(chunk.byteLength - retainedOutputTailBytes);
  }
  const combined = Buffer.concat([current, chunk]);
  return combined.byteLength <= retainedOutputTailBytes
    ? combined
    : combined.subarray(combined.byteLength - retainedOutputTailBytes);
}

function killPosixGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process exited between the state check and signal delivery.
    }
  }
}

const forceKillExitTimeoutMs = 5_000;

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const pid = child.pid;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Process ${pid ?? 'unknown'} did not exit after force kill.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function forceKillProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform !== 'win32') {
    killPosixGroup(child, 'SIGKILL');
    await waitForChildExit(child, forceKillExitTimeoutMs);
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('close', () => resolve());
    killer.once('error', () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process exited before the fallback could run.
      }
      resolve();
    });
  });
  await waitForChildExit(child, forceKillExitTimeoutMs);
}

export function gracefullyStopProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform !== 'win32') {
    killPosixGroup(child, 'SIGTERM');
    return;
  }
  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.once('error', () => {
    try {
      child.kill('SIGTERM');
    } catch {
      // The force-kill timer remains responsible for a failed graceful stop.
    }
  });
}
