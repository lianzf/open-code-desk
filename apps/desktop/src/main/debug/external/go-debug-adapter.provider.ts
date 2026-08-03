import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { mapExternalDapCapabilities } from './external-debug-capabilities';
import { ExternalDebugAdapterSession } from './external-debug-adapter-session';
import { findDebugAdapterExecutable } from './external-debug-adapter-path';
import {
  createGoLaunchArguments,
  goInitializeArguments,
  isGoDebugTarget,
  setGoExceptionBreakpoints,
} from './go-debug-launch';
import { TcpDebugAdapterProcess } from './tcp-debug-adapter-process';

export interface GoDebugAdapterProviderOptions {
  readonly adapterArguments?: ReadonlyArray<string>;
  readonly executableCandidates?: ReadonlyArray<string>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
}

export class GoDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'go-delve';
  public readonly displayName = 'Go (Delve DAP)';

  public constructor(private readonly options: GoDebugAdapterProviderOptions = {}) {}

  public async isAvailable(): Promise<boolean> {
    return (await this.adapterExecutable()) !== undefined;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (configuration.projectType !== 'go') {
      errors.push(`Delve DAP does not support project type ${configuration.projectType}.`);
    }
    if ((await this.adapterExecutable()) === undefined) {
      errors.push('dlv was not found on PATH. Install the Delve debugger for Go.');
    }
    if (!isGoDebugTarget(configuration)) {
      errors.push(
        'Go debugging requires either a compiled executable or a simple "go run <package>" configuration.',
      );
    }
    if (isGoDebugTarget(configuration) && configuration.executable.endsWith('go')) {
      warnings.push('Delve debug mode builds the selected Go package before launch.');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const executable = await this.adapterExecutable();
    if (executable === undefined) throw new Error('dlv was not found on PATH.');
    const launchArguments = await createGoLaunchArguments(
      input.command,
      input.workspaceRoot,
      input.environment,
    );
    const process = await TcpDebugAdapterProcess.start({
      executable,
      args: this.options.adapterArguments ?? ['dap', '--listen=127.0.0.1:0'],
      cwd: input.workspaceRoot,
      environment: input.environment,
      displayName: 'dlv dap',
      listeningPattern: /DAP server listening at:\s*(127\.0\.0\.1):(\d+)/u,
    });
    return ExternalDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      adapterName: 'Delve debug adapter',
      initializeArguments: goInitializeArguments,
      mapCapabilities: mapExternalDapCapabilities,
      applyExceptionPolicy: setGoExceptionBreakpoints,
      launchBeforeInitialized: true,
      launchArguments,
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPolicy: input.exceptionPolicy,
    });
  }

  private adapterExecutable(): Promise<string | undefined> {
    return findDebugAdapterExecutable(this.options.executableCandidates ?? ['dlv'], {
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
    });
  }
}
