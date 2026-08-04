import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  forceKillProcessTree,
  gracefullyStopProcessTree,
  minimalRunEnvironment,
} from '../../run/run-process-runtime';
import { DapClient } from '../dap/dap-client';
import type {
  ExternalDebugAdapterLogStream,
  ExternalDebugAdapterProcess,
} from '../external/external-debug-adapter-process';
import { jdtLsConfigurationName } from './java-jdtls-configuration';
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

const temporaryDirectoryPrefix = 'open-code-desk-jdtls-';

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

interface ValidatedResources {
  readonly launcherPath: string;
  readonly configurationPath: string;
}

async function validateResources(
  options: JavaDebugAdapterProcessOptions,
): Promise<ValidatedResources> {
  if ((await stat(options.javaExecutable).catch(() => null))?.isFile() !== true) {
    throw new Error('Java 21 or newer executable was not found.');
  }
  if ((await stat(options.debugPluginPath).catch(() => null))?.isFile() !== true) {
    throw new Error('The bundled Microsoft Java debug plug-in is missing.');
  }
  const pluginDirectory = join(options.jdtLsRoot, 'plugins');
  const launcherName = (await readdir(pluginDirectory).catch(() => []))
    .filter((name) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/u.test(name))
    .sort()
    .at(-1);
  if (launcherName === undefined) throw new Error('The bundled JDT LS launcher is missing.');
  const configurationName = jdtLsConfigurationName(
    options.platform ?? process.platform,
    options.architecture ?? process.arch,
  );
  const configurationPath = join(options.jdtLsRoot, configurationName);
  if ((await stat(configurationPath).catch(() => null))?.isDirectory() !== true) {
    throw new Error(`The bundled JDT LS ${configurationName} configuration is missing.`);
  }
  return { launcherPath: join(pluginDirectory, launcherName), configurationPath };
}

function createJdtLsArguments(
  resources: ValidatedResources,
  configurationDirectory: string,
  workspaceDirectory: string,
  javaMajorVersion: number,
): ReadonlyArray<string> {
  const argumentsValue = [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.level=WARNING',
    '-Dosgi.checkConfiguration=true',
    `-Dosgi.sharedConfiguration.area=${resources.configurationPath}`,
    '-Dosgi.sharedConfiguration.area.readOnly=true',
    '-Dosgi.configuration.cascaded=true',
    '-Xms256m',
    '-Xmx1G',
    '--add-modules=ALL-SYSTEM',
    '--add-opens',
    'java.base/java.util=ALL-UNNAMED',
    '--add-opens',
    'java.base/java.lang=ALL-UNNAMED',
    '-jar',
    resources.launcherPath,
    '-configuration',
    configurationDirectory,
    '-data',
    workspaceDirectory,
  ];
  return javaMajorVersion >= 24
    ? [
        '-Djdk.xml.maxGeneralEntitySizeLimit=0',
        '-Djdk.xml.totalEntitySizeLimit=0',
        ...argumentsValue,
      ]
    : argumentsValue;
}

async function initializeLanguageServer(
  client: JavaLanguageClient,
  options: JavaDebugAdapterProcessOptions,
  workspaceUri: string,
  javaHome: string,
  timeoutMs: number,
): Promise<void> {
  const settings = javaLanguageConfiguration(javaHome);
  await client.request(
    'initialize',
    {
      processId: process.pid,
      clientInfo: { name: 'OpenCode Desk', version: '0.7.0-alpha.1' },
      rootUri: workspaceUri,
      workspaceFolders: [{ uri: workspaceUri, name: basename(options.workspaceRoot) }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        window: { workDoneProgress: true },
        textDocument: { synchronization: { didSave: true } },
      },
      initializationOptions: {
        bundles: [resolve(options.debugPluginPath)],
        settings,
      },
    },
    timeoutMs,
  );
  client.notify('initialized', {});
  client.notify('workspace/didChangeConfiguration', { settings });
}

async function startDebugSession(client: JavaLanguageClient, timeoutMs: number): Promise<number> {
  const result = await retryRequest<unknown>(
    () =>
      client.request(
        'workspace/executeCommand',
        { command: 'vscode.java.startDebugSession', arguments: [] },
        Math.min(timeoutMs, 60_000),
      ),
    timeoutMs,
    'The Microsoft Java debug server did not become ready.',
  );
  if (!Number.isInteger(result) || (result as number) < 1 || (result as number) > 65_535) {
    throw new Error('The Microsoft Java debug server returned an invalid DAP port.');
  }
  return result as number;
}

function javaLanguageConfiguration(javaHome: string): Readonly<Record<string, unknown>> {
  return {
    java: {
      home: javaHome,
      configuration: { updateBuildConfiguration: 'automatic' },
      autobuild: { enabled: true },
      import: { gradle: { enabled: true }, maven: { enabled: true } },
    },
  };
}

async function retryRequest<T>(
  request: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /illegal character|invalid argument/iu.test(error.message)) {
        throw error;
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new Error(`${timeoutMessage}${detail}`);
}

function toMainClass(value: unknown): JavaMainClass | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.mainClass !== 'string' || record.mainClass.trim() === '') return undefined;
  return {
    mainClass: record.mainClass,
    ...(typeof record.projectName === 'string' ? { projectName: record.projectName } : {}),
    ...(typeof record.filePath === 'string' ? { filePath: record.filePath } : {}),
  };
}

function isJavaMainClass(value: JavaMainClass | undefined): value is JavaMainClass {
  return value !== undefined;
}

function recordString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Readonly<Record<string, unknown>>)[key];
  return typeof field === 'string' ? field : undefined;
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  gracefullyStopProcessTree(child);
  await Promise.race([
    new Promise<void>((resolveClose) => child.once('close', () => resolveClose())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1_000)),
  ]);
  await forceKillProcessTree(child);
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  const resolvedPath = resolve(path);
  if (
    dirname(resolvedPath) !== resolve(tmpdir()) ||
    !basename(resolvedPath).startsWith(temporaryDirectoryPrefix)
  ) {
    throw new Error('Refusing to remove an unexpected Java language server directory.');
  }
  await rm(resolvedPath, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 20 : 0,
    retryDelay: 100,
  });
}

function waitForSpawn(child: ChildProcess, displayName: string): Promise<void> {
  return new Promise((resolveSpawn, reject) => {
    const finish = (action: () => void) => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
      action();
    };
    const onSpawn = () => finish(resolveSpawn);
    const onError = (error: Error) =>
      finish(() => reject(new Error(`${displayName} could not start: ${error.message}`)));
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}
