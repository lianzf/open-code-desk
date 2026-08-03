import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import { resolveRunWorkingDirectory } from '../../run/run-execution-policy';
import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { findDebugAdapterExecutable } from '../external/external-debug-adapter-path';
import { NodeDebugAdapterSession } from '../node/node-debug-adapter-session';
import { BrowserDebugAdapterProcess } from './browser-debug-adapter-process';
import {
  type BrowserDebugAdapterType,
  browserInitializeArguments,
  createBrowserLaunchArguments,
  setBrowserExceptionBreakpoints,
} from './browser-debug-launch';

const supportedProjectTypes = new Set(['react', 'vue', 'nextjs']);

interface BrowserRuntime {
  readonly executable: string;
  readonly adapterType: BrowserDebugAdapterType;
}

export interface BrowserDebugAdapterProviderOptions {
  readonly adapterExecutable: string;
  readonly adapterServerPath: string;
  readonly browserExecutableCandidates?: ReadonlyArray<string>;
  readonly browserArguments?: ReadonlyArray<string>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
  readonly startupTimeoutMs?: number;
}

export class BrowserDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'browser-js-debug';
  public readonly displayName = 'Browser JavaScript / TypeScript';

  public constructor(private readonly options: BrowserDebugAdapterProviderOptions) {}

  public async isAvailable(): Promise<boolean> {
    return (
      (await stat(this.options.adapterServerPath).catch(() => null))?.isFile() === true &&
      (await this.browserRuntime()) !== undefined
    );
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!supportedProjectTypes.has(configuration.projectType)) {
      errors.push(`Browser debugging does not support project type ${configuration.projectType}.`);
    }
    if ((await stat(this.options.adapterServerPath).catch(() => null))?.isFile() !== true) {
      errors.push('The bundled JavaScript debug adapter is unavailable. Reinstall OpenCode Desk.');
    }
    if ((await this.browserRuntime()) === undefined) {
      errors.push('Chrome or Microsoft Edge was not found. Install a supported Chromium browser.');
    }
    if (configuration.executable.trim() === '') {
      errors.push('The browser debug configuration is missing a development server executable.');
    }
    if (configuration.port === undefined) {
      errors.push(
        'Browser debugging requires the development server port in the run configuration.',
      );
    }
    if (configuration.console === 'integratedTerminal') {
      warnings.push(
        'The approved development server output is shown in the debug console during browser debugging.',
      );
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const runtime = await this.browserRuntime();
    if (runtime === undefined) {
      throw new Error('Chrome or Microsoft Edge was not found.');
    }
    if (input.command.port === undefined) {
      throw new Error('Browser debugging requires a development server port.');
    }
    const cwd = await resolveRunWorkingDirectory(
      input.workspaceRoot,
      input.command.workingDirectory,
    );
    const process = await BrowserDebugAdapterProcess.start({
      adapterExecutable: this.options.adapterExecutable,
      adapterServerPath: this.options.adapterServerPath,
      serverExecutable: input.command.executable,
      serverArgs: [...input.command.runtimeArgs, ...input.command.args],
      cwd,
      environment: input.environment,
      sensitiveValues: input.sensitiveValues,
      port: input.command.port,
      ...(this.options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: this.options.startupTimeoutMs }),
    });
    return NodeDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      command: input.command,
      environment: input.environment,
      initializeArguments: browserInitializeArguments(runtime.adapterType),
      applyExceptionPolicy: setBrowserExceptionBreakpoints,
      launchArguments: createBrowserLaunchArguments(
        input.command,
        input.workspaceRoot,
        runtime.executable,
        runtime.adapterType,
        this.options.browserArguments,
      ),
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPolicy: input.exceptionPolicy,
    });
  }

  private async browserRuntime(): Promise<BrowserRuntime | undefined> {
    const platform = this.options.platform ?? process.platform;
    const environment = this.options.environment ?? process.env;
    const candidates =
      this.options.browserExecutableCandidates ?? defaultBrowserCandidates(platform, environment);
    const executable = await findDebugAdapterExecutable(candidates, { environment, platform });
    if (executable === undefined) return undefined;
    return {
      executable,
      adapterType:
        /^(?:msedge|microsoft edge|microsoft-edge(?:-stable|-beta|-dev)?)(?:\.exe)?$/iu.test(
          basename(executable),
        )
          ? 'pwa-msedge'
          : 'pwa-chrome',
    };
  }
}

function defaultBrowserCandidates(
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
): ReadonlyArray<string> {
  if (platform === 'win32') {
    return compact([
      environment.ProgramFiles === undefined
        ? undefined
        : `${environment.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      environment['ProgramFiles(x86)'] === undefined
        ? undefined
        : `${environment['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      environment.LOCALAPPDATA === undefined
        ? undefined
        : `${environment.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      environment.ProgramFiles === undefined
        ? undefined
        : `${environment.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      environment['ProgramFiles(x86)'] === undefined
        ? undefined
        : `${environment['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      'chrome',
      'msedge',
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/opt/google/chrome/chrome',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
  ];
}

function compact(values: ReadonlyArray<string | undefined>): ReadonlyArray<string> {
  return values.filter((value): value is string => value !== undefined);
}
