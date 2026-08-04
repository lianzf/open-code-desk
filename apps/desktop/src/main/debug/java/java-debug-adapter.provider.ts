import { stat } from 'node:fs/promises';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { ExternalDebugAdapterSession } from '../external/external-debug-adapter-session';
import { JavaDebugAdapterProcess } from './java-debug-adapter-process';
import {
  applyJavaExceptionPolicy,
  createJavaLaunchArguments,
  isDirectJavaLaunch,
  javaInitializeArguments,
  mapJavaCapabilities,
  parseDirectJavaMainClass,
  resolveJavaMainClass,
  shouldIgnoreJavaStopped,
} from './java-debug-launch';
import { findJavaRuntime, type JavaRuntimeDiscoveryOptions } from './java-runtime-discovery';

const supportedProjectTypes = new Set(['java-maven', 'java-gradle', 'spring-boot']);

export interface JavaDebugAdapterProviderOptions extends JavaRuntimeDiscoveryOptions {
  readonly jdtLsRoot: string;
  readonly debugPluginPath: string;
  readonly startupTimeoutMs?: number;
  readonly architecture?: NodeJS.Architecture;
}

export class JavaDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'java';
  public readonly displayName = 'Java (JDT LS + Java Debug Server)';

  public constructor(private readonly options: JavaDebugAdapterProviderOptions) {}

  public async isAvailable(): Promise<boolean> {
    const [runtime, jdtLs, plugin] = await Promise.all([
      this.runtime(),
      stat(this.options.jdtLsRoot).catch(() => null),
      stat(this.options.debugPluginPath).catch(() => null),
    ]);
    return runtime !== undefined && jdtLs?.isDirectory() === true && plugin?.isFile() === true;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!supportedProjectTypes.has(configuration.projectType)) {
      errors.push(`Java debugger does not support project type ${configuration.projectType}.`);
    }
    if ((await stat(this.options.jdtLsRoot).catch(() => null))?.isDirectory() !== true) {
      errors.push('The bundled Eclipse JDT Language Server is missing; reinstall OpenCode Desk.');
    }
    if ((await stat(this.options.debugPluginPath).catch(() => null))?.isFile() !== true) {
      errors.push('The bundled Microsoft Java debug server is missing; reinstall OpenCode Desk.');
    }
    if ((await this.runtime(configuration)) === undefined) {
      errors.push(
        'Java debugging requires JDK 21 or newer for JDT LS. Set JDTLS_JAVA_HOME or JAVA_HOME to a JDK 21+ installation.',
      );
    }
    if (isDirectJavaLaunch(configuration)) {
      try {
        parseDirectJavaMainClass(configuration);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      warnings.push(
        'The Java main class will be resolved after Maven or Gradle project import completes.',
      );
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const runtime = await this.runtime(input.command);
    if (runtime === undefined) throw new Error('JDK 21 or newer was not found.');
    const process = await JavaDebugAdapterProcess.start({
      javaExecutable: runtime.executable,
      javaMajorVersion: runtime.majorVersion,
      jdtLsRoot: this.options.jdtLsRoot,
      debugPluginPath: this.options.debugPluginPath,
      workspaceRoot: input.workspaceRoot,
      ...(this.options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: this.options.startupTimeoutMs }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
      ...(this.options.architecture === undefined
        ? {}
        : { architecture: this.options.architecture }),
    });
    try {
      const target = await resolveJavaMainClass(process, input.command);
      await process.buildWorkspace(target);
      const classpaths = await process.resolveClasspaths(target);
      const policyState = { current: input.exceptionPolicy };
      return await ExternalDebugAdapterSession.create({
        process,
        workspaceRoot: input.workspaceRoot,
        adapterName: 'Java debug adapter',
        initializeArguments: javaInitializeArguments,
        mapCapabilities: mapJavaCapabilities,
        applyExceptionPolicy: (client, policy) =>
          applyJavaExceptionPolicy(process, client, policyState, policy),
        shouldIgnoreStopped: (client, body) => shouldIgnoreJavaStopped(client, policyState, body),
        launchBeforeInitialized: true,
        launchArguments: createJavaLaunchArguments(
          input.command,
          input.workspaceRoot,
          input.environment,
          target,
          classpaths,
        ),
        sensitiveValues: input.sensitiveValues,
        breakpoints: input.breakpoints,
        exceptionPolicy: input.exceptionPolicy,
      });
    } catch (error) {
      await process.dispose();
      throw error;
    }
  }

  private runtime(configuration?: RunCommandSnapshot) {
    const candidates = [
      ...(configuration !== undefined && isDirectJavaLaunch(configuration)
        ? [configuration.executable]
        : []),
      ...(this.options.executableCandidates ?? []),
    ];
    return findJavaRuntime({
      ...(candidates.length === 0 ? {} : { executableCandidates: candidates }),
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
    });
  }
}
