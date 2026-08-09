import type { ChildProcess } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { forceKillProcessTree, gracefullyStopProcessTree } from '../../run/run-process-runtime';
import type { JavaDebugAdapterProcessOptions, JavaMainClass } from './java-debug-adapter-process';
import { jdtLsConfigurationName } from './java-jdtls-configuration';
import type { JavaLanguageClient } from './java-language-client';

export const temporaryDirectoryPrefix = 'open-code-desk-jdtls-';

interface ValidatedResources {
  readonly launcherPath: string;
  readonly configurationPath: string;
}

export async function validateResources(
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

export function createJdtLsArguments(
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

export async function initializeLanguageServer(
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

export async function startDebugSession(
  client: JavaLanguageClient,
  timeoutMs: number,
): Promise<number> {
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

export function javaLanguageConfiguration(javaHome: string): Readonly<Record<string, unknown>> {
  return {
    java: {
      home: javaHome,
      configuration: { updateBuildConfiguration: 'automatic' },
      autobuild: { enabled: true },
      import: { gradle: { enabled: true }, maven: { enabled: true } },
    },
  };
}

export async function retryRequest<T>(
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

export function toMainClass(value: unknown): JavaMainClass | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.mainClass !== 'string' || record.mainClass.trim() === '') return undefined;
  return {
    mainClass: record.mainClass,
    ...(typeof record.projectName === 'string' ? { projectName: record.projectName } : {}),
    ...(typeof record.filePath === 'string' ? { filePath: record.filePath } : {}),
  };
}

export function isJavaMainClass(value: JavaMainClass | undefined): value is JavaMainClass {
  return value !== undefined;
}

export function recordString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Readonly<Record<string, unknown>>)[key];
  return typeof field === 'string' ? field : undefined;
}

export function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  gracefullyStopProcessTree(child);
  await Promise.race([
    new Promise<void>((resolveClose) => child.once('close', () => resolveClose())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1_000)),
  ]);
  await forceKillProcessTree(child);
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
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

export function waitForSpawn(child: ChildProcess, displayName: string): Promise<void> {
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
