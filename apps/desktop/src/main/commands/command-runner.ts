import { spawn, type ChildProcess } from 'node:child_process';

import type { CommandExecutionStatus } from '@open-code-desk/domain';

const maximumOutputBytes = 1_000_000;
const persistedOutputTailCharacters = 100_000;

export interface CommandRunSpec {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface CommandRunResult {
  readonly status: Extract<
    CommandExecutionStatus,
    'completed' | 'failed' | 'cancelled' | 'timed_out'
  >;
  readonly outputTail: string;
  readonly outputBytes: number;
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly errorMessage?: string;
}

export interface CommandOutputChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const allowedNames =
    process.platform === 'win32'
      ? ['Path', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']
      : ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER'];
  return Object.fromEntries(
    allowedNames.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

async function terminateProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
        {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      killer.once('close', () => resolve());
      killer.once('error', () => {
        child.kill(force ? 'SIGKILL' : 'SIGTERM');
        resolve();
      });
    });
    return;
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  }
}

export class StructuredCommandRunner {
  public async run(
    spec: CommandRunSpec,
    signal: AbortSignal,
    onOutput: (output: CommandOutputChunk) => void,
  ): Promise<CommandRunResult> {
    signal.throwIfAborted();
    const child = spawn(spec.executable, [...spec.args], {
      cwd: spec.cwd,
      detached: process.platform !== 'win32',
      env: minimalEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let outputTail = '';
    let outputBytes = 0;
    let terminationReason: 'cancelled' | 'timed_out' | 'output_limit' | undefined;
    let settled = false;
    let forceKill: NodeJS.Timeout | undefined;

    const appendOutput = (stream: CommandOutputChunk['stream'], chunk: string) => {
      if (settled) {
        return;
      }
      outputBytes += Buffer.byteLength(chunk, 'utf8');
      outputTail = `${outputTail}${chunk}`.slice(-persistedOutputTailCharacters);
      onOutput({ stream, chunk });
      if (outputBytes > maximumOutputBytes && terminationReason === undefined) {
        requestTermination('output_limit');
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => appendOutput('stdout', chunk));
    child.stderr.on('data', (chunk: string) => appendOutput('stderr', chunk));

    const requestTermination = (reason: typeof terminationReason) => {
      if (terminationReason !== undefined || settled) {
        return;
      }
      terminationReason = reason;
      void terminateProcessTree(child, false);
      forceKill = setTimeout(() => {
        if (!settled) {
          void terminateProcessTree(child, true);
        }
      }, 2_000);
    };
    const abortListener = () => requestTermination('cancelled');
    signal.addEventListener('abort', abortListener, { once: true });
    const timeout = setTimeout(() => requestTermination('timed_out'), spec.timeoutMs);
    try {
      return await new Promise<CommandRunResult>((resolve) => {
        child.once('error', (error) => {
          settled = true;
          resolve({
            status: signal.aborted ? 'cancelled' : 'failed',
            outputTail,
            outputBytes,
            errorMessage: signal.aborted
              ? 'The command was cancelled before it started.'
              : `The executable could not be started: ${error.message}`,
          });
        });
        child.once('close', (exitCode, closeSignal) => {
          settled = true;
          if (terminationReason === 'cancelled') {
            resolve({
              status: 'cancelled',
              outputTail,
              outputBytes,
              ...(closeSignal === null ? {} : { terminationSignal: closeSignal }),
              errorMessage: 'The command was cancelled by the user.',
            });
            return;
          }
          if (terminationReason === 'timed_out') {
            resolve({
              status: 'timed_out',
              outputTail,
              outputBytes,
              ...(closeSignal === null ? {} : { terminationSignal: closeSignal }),
              errorMessage: `The command exceeded its ${spec.timeoutMs} ms timeout.`,
            });
            return;
          }
          if (terminationReason === 'output_limit') {
            resolve({
              status: 'failed',
              outputTail,
              outputBytes,
              ...(closeSignal === null ? {} : { terminationSignal: closeSignal }),
              errorMessage: 'The command exceeded the 1 MB output safety limit.',
            });
            return;
          }
          resolve({
            status: exitCode === 0 ? 'completed' : 'failed',
            outputTail,
            outputBytes,
            ...(exitCode === null ? {} : { exitCode }),
            ...(closeSignal === null ? {} : { terminationSignal: closeSignal }),
            ...(exitCode === 0
              ? {}
              : { errorMessage: `The command exited with code ${exitCode ?? 'unknown'}.` }),
          });
        });
      });
    } finally {
      settled = true;
      clearTimeout(timeout);
      if (forceKill !== undefined) {
        clearTimeout(forceKill);
      }
      signal.removeEventListener('abort', abortListener);
    }
  }
}
