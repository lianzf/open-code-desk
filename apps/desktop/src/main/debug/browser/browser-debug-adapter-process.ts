import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';

import {
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
  resolveStructuredSpawnCommand,
  StreamingSecretRedactor,
} from '../../run/run-process-runtime';
import type { DapClient } from '../dap/dap-client';
import type {
  ExternalDebugAdapterLogStream,
  ExternalDebugAdapterProcess,
} from '../external/external-debug-adapter-process';
import { NodeDebugAdapterProcess } from '../node/node-debug-adapter-process';

interface BufferedLog {
  readonly stream: ExternalDebugAdapterLogStream;
  readonly chunk: string;
}

const maximumBufferedStartupLogCharacters = 64 * 1024;

export interface BrowserDebugAdapterProcessOptions {
  readonly adapterExecutable: string;
  readonly adapterServerPath: string;
  readonly serverExecutable: string;
  readonly serverArgs: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly port: number;
  readonly startupTimeoutMs?: number;
}

/** Owns both the approved development server and the bundled js-debug process. */
export class BrowserDebugAdapterProcess implements ExternalDebugAdapterProcess {
  readonly #logListeners = new Set<
    (stream: ExternalDebugAdapterLogStream, chunk: string) => void
  >();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  readonly #bufferedLogs: BufferedLog[];
  readonly #unsubscribeAdapterLog: () => void;
  readonly #unsubscribeAdapterExit: () => void;
  #disposed = false;
  #exitEmitted = false;

  private constructor(
    private readonly server: ChildProcess,
    private readonly adapter: NodeDebugAdapterProcess,
    bufferedLogs: ReadonlyArray<BufferedLog>,
  ) {
    this.#bufferedLogs = [...bufferedLogs];
    server.stdout?.setEncoding('utf8');
    server.stderr?.setEncoding('utf8');
    server.stdout?.on('data', (chunk: string) => this.emitLog('stdout', chunk));
    server.stderr?.on('data', (chunk: string) => this.emitLog('stderr', chunk));
    server.once('close', (exitCode, signal) => this.emitExit(exitCode, signal));
    this.#unsubscribeAdapterLog = adapter.onLog((stream, chunk) => this.emitLog(stream, chunk));
    this.#unsubscribeAdapterExit = adapter.onExit((exitCode, signal) =>
      this.emitExit(exitCode, signal),
    );
  }

  public static async start(
    options: BrowserDebugAdapterProcessOptions,
  ): Promise<BrowserDebugAdapterProcess> {
    if (await loopbackPortIsOpen(options.port)) {
      throw new Error(
        `Browser debug port ${options.port} is already in use. Stop its current service or choose another port.`,
      );
    }
    const command = await resolveStructuredSpawnCommand(
      options.serverExecutable,
      options.serverArgs,
    );
    const server = spawn(command.executable, [...command.args], {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: minimalRunEnvironment(options.environment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try {
      const bufferedLogs = await waitForDevelopmentServer(
        server,
        options.port,
        options.startupTimeoutMs ?? 30_000,
        options.sensitiveValues,
      );
      const adapter = await NodeDebugAdapterProcess.start({
        executable: options.adapterExecutable,
        serverPath: options.adapterServerPath,
      });
      return new BrowserDebugAdapterProcess(server, adapter, bufferedLogs);
    } catch (error) {
      await stopChild(server);
      throw error;
    }
  }

  public get client(): DapClient {
    return this.adapter.client;
  }

  public get processId(): number {
    const pid = this.server.pid;
    if (pid === undefined) throw new Error('The browser development server has no process ID.');
    return pid;
  }

  public connectClient(): Promise<DapClient> {
    return this.adapter.connectClient();
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
    this.#unsubscribeAdapterLog();
    this.#unsubscribeAdapterExit();
    await this.adapter.dispose();
    await stopChild(this.server);
    this.#logListeners.clear();
    this.#exitListeners.clear();
    this.#bufferedLogs.splice(0);
  }

  private emitLog(stream: ExternalDebugAdapterLogStream, chunk: string): void {
    if (this.#logListeners.size === 0) {
      appendBufferedLog(this.#bufferedLogs, stream, chunk);
      return;
    }
    for (const listener of this.#logListeners) listener(stream, chunk);
  }

  private emitExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.#disposed || this.#exitEmitted) return;
    this.#exitEmitted = true;
    for (const listener of this.#exitListeners) listener(exitCode, signal);
  }
}

async function waitForDevelopmentServer(
  child: ChildProcess,
  port: number,
  timeoutMs: number,
  sensitiveValues: ReadonlyArray<string>,
): Promise<ReadonlyArray<BufferedLog>> {
  if (child.stdout === null || child.stderr === null) {
    throw new Error('The browser development server did not expose output streams.');
  }
  const logs: BufferedLog[] = [];
  const stdout = child.stdout;
  const stderr = child.stderr;
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  const onStdout = (chunk: string) => appendBufferedLog(logs, 'stdout', chunk);
  const onStderr = (chunk: string) => appendBufferedLog(logs, 'stderr', chunk);
  stdout.on('data', onStdout);
  stderr.on('data', onStderr);
  try {
    await waitForSpawn(child);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await loopbackPortIsOpen(port)) return logs;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `The browser development server exited before port ${port} became ready.${formatLogTail(logs, sensitiveValues)}`,
        );
      }
      await delay(100);
    }
    throw new Error(
      `The browser development server did not listen on 127.0.0.1:${port} within ${timeoutMs} ms.${formatLogTail(logs, sensitiveValues)}`,
    );
  } finally {
    stdout.off('data', onStdout);
    stderr.off('data', onStderr);
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      action();
    };
    const onSpawn = () => finish(resolve);
    const onError = (error: Error) => finish(() => reject(error));
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function loopbackPortIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendBufferedLog(
  logs: BufferedLog[],
  stream: ExternalDebugAdapterLogStream,
  chunk: string,
): void {
  logs.push({ stream, chunk: chunk.slice(-maximumBufferedStartupLogCharacters) });
  let characters = logs.reduce((total, log) => total + log.chunk.length, 0);
  while (characters > maximumBufferedStartupLogCharacters && logs.length > 1) {
    characters -= logs.shift()?.chunk.length ?? 0;
  }
  if (characters > maximumBufferedStartupLogCharacters && logs[0] !== undefined) {
    logs[0] = {
      ...logs[0],
      chunk: logs[0].chunk.slice(-maximumBufferedStartupLogCharacters),
    };
  }
}

function formatLogTail(
  logs: ReadonlyArray<BufferedLog>,
  sensitiveValues: ReadonlyArray<string>,
): string {
  const tail = logs
    .map((log) => log.chunk)
    .join('')
    .trim()
    .slice(-2_000);
  if (tail === '') return '';
  const redactor = new StreamingSecretRedactor(sensitiveValues);
  return ` Last output: ${redactor.push(tail)}${redactor.flush()}`;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  gracefullyStopProcessTree(child);
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    delay(1_000),
  ]);
  await forceKillProcessTree(child);
}
