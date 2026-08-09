import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { minimalRunEnvironment } from '../../run/run-process-runtime';
import { DapClient } from '../dap/dap-client';
import type {
  ExternalDebugAdapterLogStream,
  ExternalDebugAdapterProcess,
} from '../external/external-debug-adapter-process';
import {
  createJdtLsArguments,
  initializeLanguageServer,
  isJavaMainClass,
  javaLanguageConfiguration,
  recordString,
  removeTemporaryDirectory,
  retryRequest,
  startDebugSession,
  stopChild,
  stringArray,
  temporaryDirectoryPrefix,
  toMainClass,
  validateResources,
  waitForSpawn,
} from './java-debug-adapter-process-support';
import { JavaLanguageClient } from './java-language-client';

export interface JavaMainClass {
  readonly mainClass: string;
  readonly projectName?: string;
  readonly filePath?: string;
}

export interface JavaClasspaths {
  readonly modulePaths: ReadonlyArray<string>;
  readonly classPaths: ReadonlyArray<string>;
}

export interface JavaDebugAdapterProcessOptions {
  readonly javaExecutable: string;
  readonly javaMajorVersion: number;
  readonly jdtLsRoot: string;
  readonly debugPluginPath: string;
  readonly workspaceRoot: string;
  readonly startupTimeoutMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
}

export class JavaDebugAdapterProcess implements ExternalDebugAdapterProcess {
  readonly #logListeners = new Set<
    (stream: ExternalDebugAdapterLogStream, chunk: string) => void
  >();
  readonly #exitListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  readonly #bufferedLogs: Array<{
    readonly stream: ExternalDebugAdapterLogStream;
    readonly chunk: string;
  }> = [];
  #disposed = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly languageClient: JavaLanguageClient,
    public readonly client: DapClient,
    private readonly temporaryDirectory: string,
  ) {
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.emitLog('stderr', chunk));
    child.once('close', (exitCode, signal) => {
      for (const listener of this.#exitListeners) listener(exitCode, signal);
    });
    languageClient.onNotification((method, params) => {
      if (method === 'window/logMessage' || method === 'window/showMessage') {
        const message = recordString(params, 'message');
        if (message !== undefined) this.emitLog('stderr', `${message}\n`);
      }
    });
  }

  public static async start(
    options: JavaDebugAdapterProcessOptions,
  ): Promise<JavaDebugAdapterProcess> {
    const timeoutMs = options.startupTimeoutMs ?? 120_000;
    const resources = await validateResources(options);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), temporaryDirectoryPrefix));
    const configurationDirectory = join(temporaryDirectory, 'configuration');
    const workspaceDirectory = join(temporaryDirectory, 'workspace');
    await Promise.all([
      mkdir(configurationDirectory, { recursive: true }),
      mkdir(workspaceDirectory, { recursive: true }),
    ]);
    const workspaceUri = pathToFileURL(resolve(options.workspaceRoot)).href;
    const javaHome = dirname(dirname(resolve(options.javaExecutable)));
    const child = spawn(
      options.javaExecutable,
      createJdtLsArguments(
        resources,
        configurationDirectory,
        workspaceDirectory,
        options.javaMajorVersion,
      ),
      {
        cwd: options.workspaceRoot,
        detached: process.platform !== 'win32',
        env: { ...minimalRunEnvironment(), JAVA_HOME: javaHome },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    try {
      await waitForSpawn(child, 'Eclipse JDT Language Server');
      if (child.stdout === null || child.stdin === null) {
        throw new Error('Eclipse JDT Language Server did not expose LSP stdio streams.');
      }
      const languageClient = new JavaLanguageClient(child.stdout, child.stdin, {
        workspaceFolders: [{ uri: workspaceUri, name: basename(options.workspaceRoot) }],
        configuration: javaLanguageConfiguration(javaHome),
      });
      await initializeLanguageServer(languageClient, options, workspaceUri, javaHome, timeoutMs);
      const port = await startDebugSession(languageClient, timeoutMs);
      const client = await DapClient.connect('127.0.0.1', port, timeoutMs);
      return new JavaDebugAdapterProcess(child, languageClient, client, temporaryDirectory);
    } catch (error) {
      await stopChild(child);
      await removeTemporaryDirectory(temporaryDirectory);
      throw new Error(
        `Java debug services could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public get processId(): number {
    if (this.child.pid === undefined) throw new Error('Java language server has no process ID.');
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

  public async resolveMainClasses(): Promise<ReadonlyArray<JavaMainClass>> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const result = await retryRequest<unknown>(
        () => this.executeCommand('vscode.java.resolveMainClass', []),
        Math.max(1, deadline - Date.now()),
        'Java project import did not finish in time.',
      );
      const candidates = Array.isArray(result)
        ? result.map(toMainClass).filter(isJavaMainClass)
        : [];
      if (candidates.length > 0) return candidates;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    return [];
  }

  public async updateDebugSettings(settings: Readonly<Record<string, unknown>>): Promise<void> {
    await this.executeCommand('vscode.java.updateDebugSettings', [JSON.stringify(settings)]);
  }

  public async buildWorkspace(target: JavaMainClass): Promise<void> {
    const result = await this.executeCommand<unknown>('vscode.java.buildWorkspace', [
      JSON.stringify({
        mainClass: target.mainClass,
        projectName: target.projectName ?? '',
        isFullBuild: false,
      }),
    ]);
    if (typeof result === 'number' && result >= 2) {
      throw new Error(`Java workspace build failed with status ${result}.`);
    }
  }

  public async resolveClasspaths(target: JavaMainClass): Promise<JavaClasspaths> {
    const result = await this.executeCommand<unknown>('vscode.java.resolveClasspath', [
      target.mainClass,
      target.projectName ?? '',
    ]);
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Java language server returned an invalid classpath result.');
    }
    const modulePaths = stringArray(result[0]);
    const classPaths = stringArray(result[1]);
    if (modulePaths.length === 0 && classPaths.length === 0) {
      throw new Error('Java language server returned an empty runtime classpath.');
    }
    return { modulePaths, classPaths };
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.client.dispose();
    await this.languageClient.request('shutdown', undefined, 2_000).catch(() => undefined);
    this.languageClient.notify('exit');
    this.languageClient.dispose();
    await stopChild(this.child);
    await removeTemporaryDirectory(this.temporaryDirectory);
    this.#logListeners.clear();
    this.#exitListeners.clear();
    this.#bufferedLogs.splice(0);
  }

  private executeCommand<T>(command: string, argumentsValue: ReadonlyArray<unknown>): Promise<T> {
    return this.languageClient.request<T>(
      'workspace/executeCommand',
      { command, arguments: argumentsValue },
      60_000,
    );
  }

  private emitLog(stream: ExternalDebugAdapterLogStream, chunk: string): void {
    if (this.#logListeners.size === 0) {
      this.#bufferedLogs.push({ stream, chunk: chunk.slice(-16_384) });
      while (this.#bufferedLogs.length > 20) this.#bufferedLogs.shift();
      return;
    }
    for (const listener of this.#logListeners) listener(stream, chunk);
  }
}
