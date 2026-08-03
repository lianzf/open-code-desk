import { basename } from 'node:path';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import {
  createDotnetLaunchArguments,
  dotnetInitializeArguments,
  isDotnetDebugTarget,
  setDotnetExceptionBreakpoints,
} from './dotnet-debug-launch';
import { mapExternalDapCapabilities } from './external-debug-capabilities';
import { ExternalDebugAdapterSession } from './external-debug-adapter-session';
import { findDebugAdapterExecutable } from './external-debug-adapter-path';
import { StdioDebugAdapterProcess } from './stdio-debug-adapter-process';

export interface DotnetDebugAdapterProviderOptions {
  readonly adapterArguments?: ReadonlyArray<string>;
  readonly executableCandidates?: ReadonlyArray<string>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
}

export class DotnetDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'coreclr';
  public readonly displayName = '.NET (NetCoreDbg DAP)';

  public constructor(private readonly options: DotnetDebugAdapterProviderOptions = {}) {}

  public async isAvailable(): Promise<boolean> {
    return (await this.adapterExecutable()) !== undefined;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (configuration.projectType !== 'dotnet') {
      errors.push(`NetCoreDbg does not support project type ${configuration.projectType}.`);
    }
    if ((await this.adapterExecutable()) === undefined) {
      errors.push('netcoredbg was not found on PATH. Install NetCoreDbg for the target platform.');
    }
    if (!isDotnetDebugTarget(configuration)) {
      errors.push(
        '.NET debugging requires a compiled .dll or .exe, not dotnet run/build. Use a pre-debug build task and select its output.',
      );
    }
    if (!configuration.executable.includes('/') && !configuration.executable.includes('\\')) {
      warnings.push(
        `The .NET target ${basename(configuration.executable)} is resolved relative to the run working directory. Prefer an explicit output path.`,
      );
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const executable = await this.adapterExecutable();
    if (executable === undefined) throw new Error('netcoredbg was not found on PATH.');
    const launchArguments = await createDotnetLaunchArguments(
      input.command,
      input.workspaceRoot,
      input.environment,
    );
    const process = await StdioDebugAdapterProcess.start({
      executable,
      args: this.options.adapterArguments ?? ['--interpreter=vscode'],
      cwd: input.workspaceRoot,
      environment: input.environment,
      displayName: 'netcoredbg',
    });
    return ExternalDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      adapterName: 'NetCoreDbg adapter',
      initializeArguments: dotnetInitializeArguments,
      mapCapabilities: mapExternalDapCapabilities,
      applyExceptionPolicy: setDotnetExceptionBreakpoints,
      launchArguments,
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPolicy: input.exceptionPolicy,
    });
  }

  private adapterExecutable(): Promise<string | undefined> {
    return findDebugAdapterExecutable(this.options.executableCandidates ?? ['netcoredbg'], {
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
    });
  }
}
