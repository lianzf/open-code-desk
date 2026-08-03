import { basename } from 'node:path';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { findDebugAdapterExecutable } from './external-debug-adapter-path';
import { ExternalDebugAdapterSession } from './external-debug-adapter-session';
import {
  createLldbLaunchArguments,
  isLldbDebugTarget,
  lldbInitializeArguments,
  mapLldbCapabilities,
  setLldbExceptionBreakpoints,
} from './lldb-debug-launch';
import { StdioDebugAdapterProcess } from './stdio-debug-adapter-process';

const supportedProjectTypes = new Set(['c', 'cpp', 'rust']);

export interface LldbDebugAdapterProviderOptions {
  readonly adapterArguments?: ReadonlyArray<string>;
  readonly executableCandidates?: ReadonlyArray<string>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
}

export class LldbDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'lldb-dap';
  public readonly displayName = 'C / C++ / Rust (LLDB DAP)';

  public constructor(private readonly options: LldbDebugAdapterProviderOptions = {}) {}

  public async isAvailable(): Promise<boolean> {
    return (await this.adapterExecutable()) !== undefined;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!supportedProjectTypes.has(configuration.projectType)) {
      errors.push(`LLDB DAP does not support project type ${configuration.projectType}.`);
    }
    if ((await this.adapterExecutable()) === undefined) {
      errors.push(
        'lldb-dap was not found on PATH. Install an LLVM toolchain that includes lldb-dap.',
      );
    }
    if (!isLldbDebugTarget(configuration)) {
      errors.push(
        'LLDB debugging requires a compiled executable, not a build tool such as CMake, Make, Cargo, Ninja, or MSBuild.',
      );
    }
    if (!configuration.executable.includes('/') && !configuration.executable.includes('\\')) {
      warnings.push(
        `The debug target ${basename(configuration.executable)} is resolved relative to the run working directory. Prefer an explicit binary path.`,
      );
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const executable = await this.adapterExecutable();
    if (executable === undefined) throw new Error('lldb-dap was not found on PATH.');
    const launchArguments = await createLldbLaunchArguments(
      input.command,
      input.workspaceRoot,
      input.environment,
    );
    const process = await StdioDebugAdapterProcess.start({
      executable,
      ...(this.options.adapterArguments === undefined
        ? {}
        : { args: this.options.adapterArguments }),
      cwd: input.workspaceRoot,
      environment: input.environment,
      displayName: 'lldb-dap',
    });
    return ExternalDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      adapterName: 'LLDB debug adapter',
      initializeArguments: lldbInitializeArguments,
      mapCapabilities: mapLldbCapabilities,
      applyExceptionPolicy: setLldbExceptionBreakpoints,
      launchBeforeInitialized: true,
      launchArguments,
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPolicy: input.exceptionPolicy,
    });
  }

  private adapterExecutable(): Promise<string | undefined> {
    return findDebugAdapterExecutable(
      this.options.executableCandidates ?? ['lldb-dap', 'lldb-vscode'],
      {
        ...(this.options.environment === undefined
          ? {}
          : { environment: this.options.environment }),
        ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
      },
    );
  }
}
