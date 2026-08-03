import {
  debugAttachConfigurationSchema,
  type ProjectType,
  type RunConfiguration,
  type RunConsole,
  type SaveRunConfigurationRequest,
} from '@open-code-desk/ipc-contracts';

export const projectTypes: ReadonlyArray<ProjectType> = [
  'node',
  'typescript',
  'react',
  'vue',
  'nextjs',
  'electron',
  'java-maven',
  'java-gradle',
  'spring-boot',
  'python',
  'c',
  'cpp',
  'dotnet',
  'go',
  'rust',
  'script',
  'custom',
];

export interface EnvironmentDraft {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly configured: boolean;
}

export interface ConfigurationDraft {
  readonly name: string;
  readonly type: ProjectType;
  readonly executable: string;
  readonly args: string;
  readonly runtimeArgs: string;
  readonly workingDirectory: string;
  readonly environmentFile: string;
  readonly preLaunchTaskId: string;
  readonly postRunTaskId: string;
  readonly debugAttachEnabled: boolean;
  readonly debugAttachEnvironment: 'remote' | 'container';
  readonly debugAttachHost: string;
  readonly debugAttachPort: string;
  readonly debugAttachRemoteRoot: string;
  readonly port: string;
  readonly console: RunConsole;
  readonly environmentVariables: ReadonlyArray<EnvironmentDraft>;
  readonly makeDefault: boolean;
}

export const runConfigurationInputClassName =
  'h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-cyan-500';

export function blankRunConfigurationDraft(): ConfigurationDraft {
  return {
    name: '',
    type: 'custom',
    executable: '',
    args: '',
    runtimeArgs: '',
    workingDirectory: '',
    environmentFile: '',
    preLaunchTaskId: '',
    postRunTaskId: '',
    debugAttachEnabled: false,
    debugAttachEnvironment: 'remote',
    debugAttachHost: '127.0.0.1',
    debugAttachPort: '9229',
    debugAttachRemoteRoot: '',
    port: '',
    console: 'runOutput',
    environmentVariables: [],
    makeDefault: false,
  };
}

export function draftFromRunConfiguration(
  configuration: RunConfiguration,
  defaultConfigurationId: string | null,
): ConfigurationDraft {
  return {
    name: configuration.name,
    type: configuration.type,
    executable: configuration.executable,
    args: configuration.args.join('\n'),
    runtimeArgs: configuration.runtimeArgs.join('\n'),
    workingDirectory: configuration.workingDirectory,
    environmentFile: configuration.environmentFile ?? '',
    preLaunchTaskId: configuration.preLaunchTaskId ?? '',
    postRunTaskId: configuration.postRunTaskId ?? '',
    debugAttachEnabled: configuration.debugAttach !== undefined,
    debugAttachEnvironment: configuration.debugAttach?.environment ?? 'remote',
    debugAttachHost: configuration.debugAttach?.host ?? '127.0.0.1',
    debugAttachPort: configuration.debugAttach?.port.toString() ?? '9229',
    debugAttachRemoteRoot: configuration.debugAttach?.remoteRoot ?? '',
    port: configuration.port?.toString() ?? '',
    console: configuration.console,
    environmentVariables: configuration.environmentVariables.map((variable) => ({
      name: variable.name,
      value: variable.sensitive ? '' : (variable.value ?? ''),
      sensitive: variable.sensitive,
      configured: variable.configured,
    })),
    makeDefault: configuration.id === defaultConfigurationId,
  };
}

export function nonEmptyLines(value: string): ReadonlyArray<string> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function isDebugAttachDraftValid(draft: ConfigurationDraft): boolean {
  if (!draft.debugAttachEnabled) return true;
  const remoteRoot = draft.debugAttachRemoteRoot.trim();
  return debugAttachConfigurationSchema.safeParse({
    adapter: 'pwa-node',
    environment: draft.debugAttachEnvironment,
    host: draft.debugAttachHost.trim(),
    port: Number(draft.debugAttachPort),
    ...(remoteRoot === '' ? {} : { remoteRoot }),
  }).success;
}

export function isRunPortDraftValid(draft: ConfigurationDraft): boolean {
  if (draft.port === '') return draft.type !== 'electron';
  const port = Number(draft.port);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function toSaveRunConfigurationRequest(
  draft: ConfigurationDraft,
  workspaceId: string,
  editing: RunConfiguration | undefined,
): SaveRunConfigurationRequest {
  return {
    ...(editing === undefined ? {} : { id: editing.id }),
    workspaceId,
    name: draft.name,
    type: draft.type,
    executable: draft.executable,
    args: [...nonEmptyLines(draft.args)],
    runtimeArgs: [...nonEmptyLines(draft.runtimeArgs)],
    workingDirectory: draft.workingDirectory,
    environmentVariables: draft.environmentVariables
      .filter((variable) => variable.name.trim() !== '')
      .map((variable) => ({
        name: variable.name,
        ...(variable.value === '' && variable.sensitive && variable.configured
          ? {}
          : { value: variable.value }),
        sensitive: variable.sensitive,
      })),
    ...(draft.environmentFile.trim() === ''
      ? {}
      : { environmentFile: draft.environmentFile.trim() }),
    ...(draft.preLaunchTaskId === '' ? {} : { preLaunchTaskId: draft.preLaunchTaskId }),
    ...(draft.postRunTaskId === '' ? {} : { postRunTaskId: draft.postRunTaskId }),
    ...(draft.debugAttachEnabled
      ? {
          debugAttach: {
            adapter: 'pwa-node' as const,
            environment: draft.debugAttachEnvironment,
            host: draft.debugAttachHost.trim(),
            port: Number(draft.debugAttachPort),
            ...(draft.debugAttachRemoteRoot.trim() === ''
              ? {}
              : { remoteRoot: draft.debugAttachRemoteRoot.trim() }),
          },
        }
      : {}),
    ...(draft.port === '' ? {} : { port: Number(draft.port) }),
    console: draft.console,
    autoGenerated: editing?.autoGenerated ?? false,
  };
}
