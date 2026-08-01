import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { DapClient } from '../dap/dap-client';
import {
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
} from '../../run/run-process-runtime';

const listeningPattern = /Debug server listening at 127\.0\.0\.1:(\d+)/u;

export interface NodeDebugAdapterProcessOptions {
  readonly executable: string;
  readonly serverPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly startupTimeoutMs?: number;
}

export class NodeDebugAdapterProcess {
  readonly #logListeners = new Set<(stream: 'stdout' | 'stderr', chunk: string) => void>();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  #disposed = false;

  private constructor(
    private readonly child: ChildProcess,
    public readonly client: DapClient,
    private readonly port: number,
  ) {
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.emitLog('stdout', chunk));
    child.stderr?.on('data', (chunk: string) => this.emitLog('stderr', chunk));
    child.once('close', (exitCode, signal) => {
      for (const listener of this.#exitListeners) {
        listener(exitCode, signal);
      }
    });
  }

  public static async start(
    options: NodeDebugAdapterProcessOptions,
  ): Promise<NodeDebugAdapterProcess> {
    const serverStat = await stat(options.serverPath).catch(() => null);
    if (serverStat?.isFile() !== true) {
      throw new Error('找不到随应用分发的 Node.js 调试适配器。');
    }
    const child = spawn(options.executable, [options.serverPath, '0', '127.0.0.1'], {
      detached: process.platform !== 'win32',
      env: {
        ...minimalRunEnvironment(),
        ELECTRON_RUN_AS_NODE: '1',
        ...options.environment,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try {
      const port = await waitForListeningPort(child, options.startupTimeoutMs ?? 10_000);
      const client = await DapClient.connect('127.0.0.1', port, options.startupTimeoutMs ?? 10_000);
      return new NodeDebugAdapterProcess(child, client, port);
    } catch (error) {
      await forceKillProcessTree(child);
      throw error;
    }
  }

  public get processId(): number {
    const pid = this.child.pid;
    if (pid === undefined) {
      throw new Error('调试适配器没有有效进程 ID。');
    }
    return pid;
  }

  public onLog(listener: (stream: 'stdout' | 'stderr', chunk: string) => void): () => void {
    this.#logListeners.add(listener);
    return () => this.#logListeners.delete(listener);
  }

  public onExit(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  public connectClient(): Promise<DapClient> {
    return DapClient.connect('127.0.0.1', this.port);
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
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

  private emitLog(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const listener of this.#logListeners) {
      listener(stream, chunk);
    }
  }
}

function waitForListeningPort(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const finish = (action: () => void) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onErrorData);
      child.off('error', onError);
      child.off('close', onClose);
      action();
    };
    const onData = (chunk: Buffer | string) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-4_096);
      const match = listeningPattern.exec(stdout);
      if (match?.[1] !== undefined) {
        finish(() => resolve(Number(match[1])));
      }
    };
    const onError = (error: Error) => finish(() => reject(error));
    const onErrorData = (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_096);
    };
    const onClose = (exitCode: number | null) =>
      finish(() =>
        reject(
          new Error(
            `Node.js 调试适配器提前退出，退出码 ${String(exitCode)}。${
              stderr === '' ? '' : ` ${stderr.trim()}`
            }`,
          ),
        ),
      );
    const timer = setTimeout(
      () => finish(() => reject(new Error('Node.js 调试适配器启动超时。'))),
      timeoutMs,
    );
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onErrorData);
    child.once('error', onError);
    child.once('close', onClose);
  });
}
