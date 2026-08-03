import { spawn, type ChildProcess } from 'node:child_process';

import {
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
} from '../../run/run-process-runtime';
import { DapClient } from '../dap/dap-client';
import type {
  ExternalDebugAdapterLogStream,
  ExternalDebugAdapterProcess,
} from './external-debug-adapter-process';

export interface StdioDebugAdapterProcessOptions {
  readonly executable: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly displayName: string;
}

export class StdioDebugAdapterProcess implements ExternalDebugAdapterProcess {
  readonly #logListeners = new Set<
    (stream: ExternalDebugAdapterLogStream, chunk: string) => void
  >();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  #disposed = false;

  private constructor(
    private readonly child: ChildProcess,
    public readonly client: DapClient,
  ) {
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const listener of this.#logListeners) listener('stderr', chunk);
    });
    child.once('close', (exitCode, signal) => {
      for (const listener of this.#exitListeners) listener(exitCode, signal);
    });
  }

  public static async start(
    options: StdioDebugAdapterProcessOptions,
  ): Promise<StdioDebugAdapterProcess> {
    const child = spawn(options.executable, [...(options.args ?? [])], {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: minimalRunEnvironment(options.environment),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForSpawn(child, options.displayName);
    if (child.stdout === null || child.stdin === null) {
      await forceKillProcessTree(child);
      throw new Error(`${options.displayName} did not expose DAP stdio streams.`);
    }
    const client = DapClient.fromStreams(child.stdout, child.stdin);
    return new StdioDebugAdapterProcess(child, client);
  }

  public get processId(): number {
    if (this.child.pid === undefined) throw new Error('The debug adapter has no process ID.');
    return this.child.pid;
  }

  public onLog(
    listener: (stream: ExternalDebugAdapterLogStream, chunk: string) => void,
  ): () => void {
    this.#logListeners.add(listener);
    return () => this.#logListeners.delete(listener);
  }

  public onExit(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.client.dispose();
    gracefullyStopProcessTree(this.child);
    await Promise.race([
      new Promise<void>((resolve) => this.child.once('close', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    await forceKillProcessTree(this.child);
    this.#logListeners.clear();
    this.#exitListeners.clear();
  }
}

function waitForSpawn(child: ChildProcess, displayName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      action();
    };
    const onSpawn = () => finish(resolve);
    const onError = (error: Error) =>
      finish(() => reject(new Error(`${displayName} could not start: ${error.message}`)));
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}
