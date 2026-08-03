import { stat } from 'node:fs/promises';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { NodeDebugAdapterProcess } from '../node/node-debug-adapter-process';
import { NodeDebugAdapterSession } from '../node/node-debug-adapter-session';
import {
  createElectronMainLaunchArguments,
  createElectronRendererAttachArguments,
  electronMainInitializeArguments,
  electronRendererInitializeArguments,
  setElectronExceptionBreakpoints,
} from './electron-debug-launch';
import { electronDebugPortIsOpen, waitForElectronDebugPort } from './electron-debug-port';

export interface ElectronDebugAdapterProviderOptions {
  readonly adapterExecutable: string;
  readonly adapterServerPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly startupTimeoutMs?: number;
}

export class ElectronDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'electron-js-debug';
  public readonly displayName = 'Electron Main / Renderer JavaScript';

  public constructor(private readonly options: ElectronDebugAdapterProviderOptions) {}

  public async isAvailable(): Promise<boolean> {
    return (await stat(this.options.adapterServerPath).catch(() => null))?.isFile() === true;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (configuration.projectType !== 'electron') {
      errors.push(`Electron debugging does not support project type ${configuration.projectType}.`);
    }
    if ((await stat(this.options.adapterServerPath).catch(() => null))?.isFile() !== true) {
      errors.push('The bundled JavaScript debug adapter is unavailable. Reinstall OpenCode Desk.');
    }
    if (configuration.executable.trim() === '') {
      errors.push('The Electron debug configuration is missing the Electron executable.');
    }
    if (configuration.port === undefined) {
      errors.push('Electron debugging requires a renderer debug port in the run configuration.');
    }
    if (configuration.console === 'integratedTerminal') {
      warnings.push('Electron main-process output is shown in the debug console.');
    }
    warnings.push(
      'Electron debugging opens a loopback-only Chromium DevTools endpoint for the renderer process.',
    );
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    if (input.command.port === undefined) {
      throw new Error('Electron 调试配置缺少渲染进程调试端口。');
    }
    if (await electronDebugPortIsOpen(input.command.port)) {
      throw new Error(
        `Electron 渲染进程调试端口 127.0.0.1:${input.command.port} 已被占用；为避免附加到非本会话目标，请更换端口。`,
      );
    }
    const process = await NodeDebugAdapterProcess.start({
      executable: this.options.adapterExecutable,
      serverPath: this.options.adapterServerPath,
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
      ...(this.options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: this.options.startupTimeoutMs }),
    });
    let session: NodeDebugAdapterSession | undefined;
    try {
      session = await NodeDebugAdapterSession.create({
        process,
        workspaceRoot: input.workspaceRoot,
        command: input.command,
        environment: input.environment,
        sensitiveValues: input.sensitiveValues,
        breakpoints: input.breakpoints,
        exceptionPolicy: input.exceptionPolicy,
        initializeArguments: electronMainInitializeArguments,
        launchArguments: createElectronMainLaunchArguments(
          input.command,
          input.workspaceRoot,
          input.environment,
        ),
        applyExceptionPolicy: setElectronExceptionBreakpoints,
      });
      await waitForElectronDebugPort(input.command.port, this.options.startupTimeoutMs ?? 30_000);
      await session.attachAdditionalClient({
        initializeArguments: electronRendererInitializeArguments,
        requestCommand: 'attach',
        launchArguments: createElectronRendererAttachArguments(input.command, input.workspaceRoot),
        terminateDebuggeeOnDisconnect: false,
        applyExceptionPolicy: setElectronExceptionBreakpoints,
      });
      return session;
    } catch (error) {
      if (session === undefined) await process.dispose();
      else await session.disconnect();
      throw error;
    }
  }
}
