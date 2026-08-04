import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
} from '../../run/run-process-runtime';
import { DapClient } from '../dap/dap-client';

interface DebugpyEndpoints {
  readonly client: { readonly host: string; readonly port: number };
}

export interface PythonDebugAdapterProcessOptions {
  readonly executable: string;
  readonly adapterPath: string;
  readonly workspaceRoot: string;
  readonly startupTimeoutMs?: number;
}

export interface PythonDebugAdapterConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly startupTimeoutMs?: number;
}

export class PythonDebugAdapterProcess {
  readonly #logListeners = new Set<(stream: 'stdout' | 'stderr', chunk: string) => void>();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  readonly #unsubscribeClientClose: () => void;
  #disposed = false;

  private constructor(
    private readonly child: ChildProcess | undefined,
    public readonly client: DapClient,
    private readonly temporaryDirectory: string | undefined,
  ) {
    if (child === undefined) {
      this.#unsubscribeClientClose = client.onClose(() => this.emitExit(null, null));
    } else {
      this.#unsubscribeClientClose = () => undefined;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => this.emitLog('stdout', chunk));
      child.stderr?.on('data', (chunk: string) => this.emitLog('stderr', chunk));
      child.once('close', (exitCode, signal) => this.emitExit(exitCode, signal));
    }
  }

  public static async start(
    options: PythonDebugAdapterProcessOptions,
  ): Promise<PythonDebugAdapterProcess> {
    const adapterMain = join(options.adapterPath, '__main__.py');
    if ((await stat(adapterMain).catch(() => null))?.isFile() !== true) {
      throw new Error('找不到随应用分发的 Python 调试适配器，请重新安装 OpenCode Desk。');
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debugpy-'));
    const endpointsPath = join(temporaryDirectory, 'endpoints.json');
    const child = spawn(
      options.executable,
      [options.adapterPath, '--host', '127.0.0.1', '--port', '0'],
      {
        cwd: options.workspaceRoot,
        detached: process.platform !== 'win32',
        env: {
          ...minimalRunEnvironment(),
          DEBUGPY_ADAPTER_ENDPOINTS: endpointsPath,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    try {
      const endpoints = await waitForEndpoints(
        child,
        endpointsPath,
        options.startupTimeoutMs ?? 10_000,
      );
      const client = await DapClient.connect(
        endpoints.client.host,
        endpoints.client.port,
        options.startupTimeoutMs ?? 10_000,
      );
      return new PythonDebugAdapterProcess(child, client, temporaryDirectory);
    } catch (error) {
      await forceKillProcessTree(child);
      await rm(temporaryDirectory, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Python 调试器启动失败：${message} 请确认运行配置选择的是 Python 3.8 或更高版本。`,
      );
    }
  }

  public static async connect(
    options: PythonDebugAdapterConnectionOptions,
  ): Promise<PythonDebugAdapterProcess> {
    try {
      const client = await DapClient.connect(
        options.host,
        options.port,
        options.startupTimeoutMs ?? 10_000,
      );
      return new PythonDebugAdapterProcess(undefined, client, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接 Python 附加调试目标：${message}`);
    }
  }

  public get processId(): number {
    if (this.child?.pid === undefined) {
      throw new Error('Python 附加调试目标没有提供有效进程 ID。');
    }
    return this.child.pid;
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

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeClientClose();
    this.client.dispose();
    const child = this.child;
    if (child === undefined) {
      this.#logListeners.clear();
      this.#exitListeners.clear();
      return;
    }
    gracefullyStopProcessTree(child);
    await Promise.race([
      new Promise<void>((resolve) => child.once('close', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    await forceKillProcessTree(child);
    if (this.temporaryDirectory !== undefined) {
      await rm(this.temporaryDirectory, { recursive: true, force: true });
    }
    this.#logListeners.clear();
    this.#exitListeners.clear();
  }

  private emitLog(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const listener of this.#logListeners) listener(stream, chunk);
  }

  private emitExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.#exitListeners) listener(exitCode, signal);
  }
}

function waitForEndpoints(
  child: ChildProcess,
  endpointsPath: string,
  timeoutMs: number,
): Promise<DebugpyEndpoints> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('close', onClose);
      action();
    };
    const onStderr = (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_096);
    };
    const onError = (error: Error) => finish(() => reject(error));
    const onClose = (exitCode: number | null) =>
      finish(() =>
        reject(
          new Error(
            `适配器提前退出（退出码 ${String(exitCode)}）。${stderr === '' ? '' : ` ${stderr.trim()}`}`,
          ),
        ),
      );
    const poll = async () => {
      if (settled) return;
      const parsed = await readEndpoints(endpointsPath);
      if (parsed !== undefined) {
        finish(() => resolve(parsed));
        return;
      }
      setTimeout(() => void poll(), 25);
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('等待 debugpy 端点超时。'))),
      timeoutMs,
    );
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
    void poll();
  });
}

async function readEndpoints(path: string): Promise<DebugpyEndpoints | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const client = (parsed as Readonly<Record<string, unknown>>).client;
    if (typeof client !== 'object' || client === null) return undefined;
    const endpoint = client as Readonly<Record<string, unknown>>;
    return endpoint.host === '127.0.0.1' &&
      typeof endpoint.port === 'number' &&
      Number.isInteger(endpoint.port) &&
      endpoint.port > 0
      ? { client: { host: endpoint.host, port: endpoint.port } }
      : undefined;
  } catch {
    return undefined;
  }
}
