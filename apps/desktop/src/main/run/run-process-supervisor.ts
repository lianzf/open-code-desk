import { spawn, type ChildProcess } from 'node:child_process';

import {
  appendRetainedOutputTail,
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
  resolveStructuredSpawnCommand,
  StreamingSecretRedactor,
} from './run-process-runtime';

export const maximumForwardedRunOutputBytes = 1024 * 1024;
export const retainedRunOutputTailBytes = 64 * 1024;

export interface RunProcessStartSpec {
  readonly executionId: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  /** Values have already been resolved by the configuration/secret layer. */
  readonly resolvedEnvironment?: Readonly<Record<string, string>>;
  /** Exact values that must be removed before output is emitted or retained. */
  readonly sensitiveValues?: ReadonlyArray<string>;
  readonly port?: number;
}

export type RunProcessStatus = 'running' | 'stopping';
export type RunProcessExitStatus = 'completed' | 'failed' | 'stopped';

export interface RunProcessInfo {
  readonly executionId: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly status: RunProcessStatus;
  readonly outputBytes: number;
  readonly forwardedOutputBytes: number;
  readonly outputTruncated: boolean;
  readonly outputTail: string;
  readonly port?: number;
}

export interface RunProcessExitResult {
  readonly executionId: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: RunProcessExitStatus;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly outputBytes: number;
  readonly forwardedOutputBytes: number;
  readonly outputTruncated: boolean;
  readonly outputTail: string;
  readonly errorMessage?: string;
}

export type RunProcessEvent =
  | {
      readonly type: 'started';
      readonly executionId: string;
      readonly pid: number;
      readonly startedAt: string;
    }
  | {
      readonly type: 'output';
      readonly executionId: string;
      readonly stream: 'stdout' | 'stderr';
      readonly chunk: string;
      readonly timestamp: string;
    }
  | ({ readonly type: 'exit' } & RunProcessExitResult);

interface ActiveRun {
  readonly spec: RunProcessStartSpec;
  readonly child: ChildProcess;
  readonly pid: number;
  readonly startedAt: string;
  readonly completion: Promise<RunProcessExitResult>;
  resolveCompletion(result: RunProcessExitResult): void;
  status: RunProcessStatus;
  stopRequested: boolean;
  settled: boolean;
  outputBytes: number;
  forwardedOutputBytes: number;
  outputTail: Buffer;
  readonly stdoutRedactor: StreamingSecretRedactor;
  readonly stderrRedactor: StreamingSecretRedactor;
  forceTimer?: NodeJS.Timeout;
}

export interface RunProcessSupervisorOptions {
  readonly gracefulStopTimeoutMs?: number;
}

export class RunProcessSupervisor {
  readonly #runs = new Map<string, ActiveRun>();
  readonly #results = new Map<string, RunProcessExitResult>();
  readonly #seenExecutionIds = new Set<string>();
  readonly #listeners = new Set<(event: RunProcessEvent) => void>();
  readonly #gracefulStopTimeoutMs: number;

  public constructor(options: RunProcessSupervisorOptions = {}) {
    this.#gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? 2_000;
  }

  public subscribe(listener: (event: RunProcessEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public list(): ReadonlyArray<RunProcessInfo> {
    return [...this.#runs.values()].map((run) => this.toInfo(run));
  }

  public get(executionId: string): RunProcessInfo | null {
    const run = this.#runs.get(executionId);
    return run === undefined ? null : this.toInfo(run);
  }

  public async start(spec: RunProcessStartSpec): Promise<RunProcessInfo> {
    if (this.#seenExecutionIds.has(spec.executionId)) {
      throw new Error(`Run execution ${spec.executionId} has already been used.`);
    }
    const duplicate = [...this.#runs.values()].find(
      (run) =>
        (spec.port !== undefined && run.spec.port === spec.port) ||
        (run.spec.executable === spec.executable &&
          run.spec.cwd === spec.cwd &&
          sameArguments(run.spec.args, spec.args)),
    );
    if (duplicate !== undefined) {
      throw new Error(
        `The same service is already running as execution ${duplicate.spec.executionId}.`,
      );
    }

    const command = await resolveStructuredSpawnCommand(spec.executable, spec.args);
    const child = spawn(command.executable, [...command.args], {
      cwd: spec.cwd,
      detached: process.platform !== 'win32',
      env: minimalRunEnvironment(spec.resolvedEnvironment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // Subscribe immediately after spawn(). Fast local executables can emit
    // `spawn` before the remaining run bookkeeping has been initialized.
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const pid = child.pid;
    if (pid === undefined) {
      try {
        await spawned;
      } catch (error) {
        throw new Error(
          `Run execution ${spec.executionId} could not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
      throw new Error(`Run execution ${spec.executionId} started without a process identifier.`);
    }

    let resolveCompletion!: (result: RunProcessExitResult) => void;
    const completion = new Promise<RunProcessExitResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const run: ActiveRun = {
      spec: {
        ...spec,
        args: [...spec.args],
        ...(spec.resolvedEnvironment === undefined
          ? {}
          : { resolvedEnvironment: { ...spec.resolvedEnvironment } }),
      },
      child,
      pid,
      startedAt: new Date().toISOString(),
      completion,
      resolveCompletion,
      status: 'running',
      stopRequested: false,
      settled: false,
      outputBytes: 0,
      forwardedOutputBytes: 0,
      outputTail: Buffer.alloc(0),
      stdoutRedactor: new StreamingSecretRedactor(spec.sensitiveValues ?? []),
      stderrRedactor: new StreamingSecretRedactor(spec.sensitiveValues ?? []),
    };
    this.#seenExecutionIds.add(spec.executionId);
    this.#runs.set(spec.executionId, run);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onOutput(run, 'stdout', chunk));
    child.stderr?.on('data', (chunk: string) => this.onOutput(run, 'stderr', chunk));
    child.once('close', (exitCode, signal) => this.finish(run, exitCode, signal));

    try {
      await spawned;
    } catch (error) {
      this.finish(run, null, null, error);
      throw new Error(
        `Run execution ${spec.executionId} could not start: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    this.emit({
      type: 'started',
      executionId: spec.executionId,
      pid,
      startedAt: run.startedAt,
    });
    return this.toInfo(run);
  }

  public async waitForExit(executionId: string): Promise<RunProcessExitResult> {
    const run = this.#runs.get(executionId);
    if (run !== undefined) {
      return run.completion;
    }
    const result = this.#results.get(executionId);
    if (result !== undefined) {
      return result;
    }
    throw new Error(`Run execution ${executionId} was not found.`);
  }

  public async stop(executionId: string): Promise<boolean> {
    const run = this.#runs.get(executionId);
    if (run === undefined) {
      return false;
    }
    if (!run.stopRequested) {
      run.stopRequested = true;
      run.status = 'stopping';
      gracefullyStopProcessTree(run.child);
      run.forceTimer = setTimeout(() => {
        void forceKillProcessTree(run.child);
      }, this.#gracefulStopTimeoutMs);
    }
    await run.completion;
    return true;
  }

  public async closeAll(): Promise<void> {
    await Promise.all([...this.#runs.keys()].map((executionId) => this.stop(executionId)));
  }

  private onOutput(run: ActiveRun, stream: 'stdout' | 'stderr', chunk: string): void {
    if (run.settled) {
      return;
    }
    const redacted =
      stream === 'stdout' ? run.stdoutRedactor.push(chunk) : run.stderrRedactor.push(chunk);
    this.recordOutput(run, stream, redacted);
  }

  private recordOutput(run: ActiveRun, stream: 'stdout' | 'stderr', chunk: string): void {
    if (chunk.length === 0) {
      return;
    }
    const bytes = Buffer.from(chunk, 'utf8');
    run.outputBytes += bytes.byteLength;
    run.outputTail = appendRetainedOutputTail(run.outputTail, bytes);

    const remaining = maximumForwardedRunOutputBytes - run.forwardedOutputBytes;
    if (remaining <= 0) {
      return;
    }
    const forwarded = bytes.byteLength <= remaining ? bytes : bytes.subarray(0, remaining);
    run.forwardedOutputBytes += forwarded.byteLength;
    this.emit({
      type: 'output',
      executionId: run.spec.executionId,
      stream,
      chunk: forwarded.toString('utf8'),
      timestamp: new Date().toISOString(),
    });
  }

  private finish(
    run: ActiveRun,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    spawnError?: unknown,
  ): void {
    if (run.settled) {
      return;
    }
    this.recordOutput(run, 'stdout', run.stdoutRedactor.flush());
    this.recordOutput(run, 'stderr', run.stderrRedactor.flush());
    run.settled = true;
    if (run.forceTimer !== undefined) {
      clearTimeout(run.forceTimer);
    }
    this.#runs.delete(run.spec.executionId);
    const status: RunProcessExitStatus = run.stopRequested
      ? 'stopped'
      : spawnError !== undefined || exitCode !== 0
        ? 'failed'
        : 'completed';
    const result: RunProcessExitResult = {
      executionId: run.spec.executionId,
      pid: run.pid,
      startedAt: run.startedAt,
      finishedAt: new Date().toISOString(),
      status,
      exitCode,
      signal,
      outputBytes: run.outputBytes,
      forwardedOutputBytes: run.forwardedOutputBytes,
      outputTruncated:
        run.outputBytes > run.forwardedOutputBytes || run.outputBytes > retainedRunOutputTailBytes,
      outputTail: run.outputTail.toString('utf8'),
      ...(spawnError === undefined
        ? exitCode === null || exitCode === 0
          ? {}
          : { errorMessage: `The process exited with code ${exitCode}.` }
        : {
            errorMessage: `The executable could not be started: ${
              spawnError instanceof Error ? spawnError.message : String(spawnError)
            }`,
          }),
    };
    this.#results.set(run.spec.executionId, result);
    run.resolveCompletion(result);
    this.emit({ type: 'exit', ...result });
  }

  private toInfo(run: ActiveRun): RunProcessInfo {
    return {
      executionId: run.spec.executionId,
      executable: run.spec.executable,
      args: [...run.spec.args],
      cwd: run.spec.cwd,
      pid: run.pid,
      startedAt: run.startedAt,
      status: run.status,
      outputBytes: run.outputBytes,
      forwardedOutputBytes: run.forwardedOutputBytes,
      outputTruncated:
        run.outputBytes > run.forwardedOutputBytes || run.outputBytes > retainedRunOutputTailBytes,
      outputTail: run.outputTail.toString('utf8'),
      ...(run.spec.port === undefined ? {} : { port: run.spec.port }),
    };
  }

  private emit(event: RunProcessEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // One UI/event consumer must not destabilize a supervised process.
      }
    }
  }
}

function sameArguments(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
