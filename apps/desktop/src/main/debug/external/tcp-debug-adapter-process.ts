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

export interface TcpDebugAdapterProcessOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly listeningPattern: RegExp;
  readonly startupTimeoutMs?: number;
}

interface BufferedLog {
  readonly stream: ExternalDebugAdapterLogStream;
  readonly chunk: string;
}

export class TcpDebugAdapterProcess implements ExternalDebugAdapterProcess {
  readonly #logListeners = new Set<
    (stream: ExternalDebugAdapterLogStream, chunk: string) => void
  >();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  readonly #bufferedLogs: BufferedLog[];
  #disposed = false;

  private constructor(
    private readonly child: ChildProcess,
    public readonly client: DapClient,
    bufferedLogs: ReadonlyArray<BufferedLog>,
  ) {
    this.#bufferedLogs = [...bufferedLogs];
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.emitLog('stdout', chunk));
    child.stderr?.on('data', (chunk: string) => this.emitLog('stderr', chunk));
    child.once('close', (exitCode, signal) => {
      for (const listener of this.#exitListeners) listener(exitCode, signal);
    });
  }

  public static async start(
    options: TcpDebugAdapterProcessOptions,
  ): Promise<TcpDebugAdapterProcess> {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: minimalRunEnvironment(options.environment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try {
      const startup = await waitForServerAddress(
        child,
        options.displayName,
        options.listeningPattern,
        options.startupTimeoutMs ?? 15_000,
      );
      const client = await DapClient.connect(startup.host, startup.port, 10_000);
      return new TcpDebugAdapterProcess(child, client, startup.logs);
    } catch (error) {
      await forceKillProcessTree(child);
      throw error;
    }
  }

  public get processId(): number {
    if (this.child.pid === undefined) throw new Error('The debug adapter has no process ID.');
    return this.child.pid;
  }

  public onLog(
    listener: (stream: ExternalDebugAdapterLogStream, chunk: string) => void,
  ): () => void {
    this.#logListeners.add(listener);
    if (this.#logListeners.size === 1) {
      for (const log of this.#bufferedLogs.splice(0)) listener(log.stream, log.chunk);
    }
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
    this.#bufferedLogs.splice(0);
  }

  private emitLog(stream: ExternalDebugAdapterLogStream, chunk: string): void {
    if (this.#logListeners.size === 0) {
      this.#bufferedLogs.push({ stream, chunk });
      if (this.#bufferedLogs.length > 200) this.#bufferedLogs.shift();
      return;
    }
    for (const listener of this.#logListeners) listener(stream, chunk);
  }
}

async function waitForServerAddress(
  child: ChildProcess,
  displayName: string,
  listeningPattern: RegExp,
  timeoutMs: number,
): Promise<{ readonly host: string; readonly port: number; readonly logs: BufferedLog[] }> {
  if (child.stdout === null || child.stderr === null) {
    throw new Error(`${displayName} did not expose startup output streams.`);
  }
  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;
  return new Promise((resolve, reject) => {
    const logs: BufferedLog[] = [];
    let stdout = '';
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${displayName} did not report a DAP address.`))),
      timeoutMs,
    );
    const finish = (action: () => void) => {
      clearTimeout(timer);
      stdoutStream.off('data', onStdout);
      stderrStream.off('data', onStderr);
      child.off('error', onError);
      child.off('close', onClose);
      action();
    };
    const onStdout = (chunk: Buffer | string) => {
      const text = chunk.toString();
      logs.push({ stream: 'stdout', chunk: text });
      stdout = `${stdout}${text}`.slice(-16_384);
      listeningPattern.lastIndex = 0;
      const match = listeningPattern.exec(stdout);
      const host = match?.[1];
      const rawPort = match?.[2];
      if (host === undefined || rawPort === undefined) return;
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        finish(() => reject(new Error(`${displayName} reported an invalid DAP port.`)));
        return;
      }
      finish(() => resolve({ host, port, logs }));
    };
    const onStderr = (chunk: Buffer | string) =>
      logs.push({ stream: 'stderr', chunk: chunk.toString() });
    const onError = (error: Error) => finish(() => reject(error));
    const onClose = (exitCode: number | null) =>
      finish(() =>
        reject(
          new Error(`${displayName} exited before listening (exit ${exitCode ?? 'unknown'}).`),
        ),
      );
    stdoutStream.on('data', onStdout);
    stderrStream.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
  });
}
