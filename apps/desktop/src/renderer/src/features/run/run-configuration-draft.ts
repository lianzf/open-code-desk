import type { ProjectType, RunConfiguration, RunConsole } from '@open-code-desk/ipc-contracts';

export const projectTypes: ReadonlyArray<ProjectType> = [
  'node',
  'typescript',
  'react',
  'vue',
  'nextjs',
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
