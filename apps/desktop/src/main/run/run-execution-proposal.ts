import { randomUUID } from 'node:crypto';

import type { RunExecution } from '@open-code-desk/domain';

import { assessCommandRisk } from '../commands/command-risk-policy';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { RunConfigurationRepository } from './run-configuration.repository';
import { RunExecutionServiceError } from './run-execution-errors';
import {
  publicEnvironmentVariables,
  readEnvironmentFile,
  resolveRunWorkingDirectory,
  runApprovalDigest,
} from './run-execution-policy';
import type { RunExecutionRepository } from './run-execution.repository';
import { resolveStructuredSpawnCommand } from './run-process-runtime';

export async function createRunProposal(input: {
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly restartOfExecutionId?: string;
  readonly configurations: RunConfigurationRepository;
  readonly executions: RunExecutionRepository;
  readonly workspaces: WorkspaceService;
}): Promise<RunExecution> {
  const configuration = input.configurations.findStoredById(input.configurationId);
  if (configuration === null || configuration.workspaceId !== input.workspaceId) {
    throw new RunExecutionServiceError(
      'RUN_CONFIGURATION_NOT_FOUND',
      '找不到当前工作区的运行配置。',
    );
  }
  if (configuration.preLaunchTaskId !== undefined || configuration.postRunTaskId !== undefined) {
    throw new RunExecutionServiceError(
      'RUN_TASKS_NOT_SUPPORTED',
      '当前阶段尚未支持运行前或运行后任务，请先移除该任务引用。',
    );
  }
  const workspace = await input.workspaces.getById(input.workspaceId);
  const cwd = await resolveRunWorkingDirectory(workspace.rootPath, configuration.workingDirectory);
  const environmentFileSnapshot =
    configuration.environmentFile === undefined
      ? null
      : await readEnvironmentFile(workspace.rootPath, configuration.environmentFile);
  const configuredArgs = [...configuration.runtimeArgs, ...configuration.args];
  const resolvedCommand = await resolveStructuredSpawnCommand(
    configuration.executable,
    configuredArgs,
  );
  const command = {
    configurationId: configuration.id,
    configurationUpdatedAt: configuration.updatedAt,
    configurationName: configuration.name,
    projectType: configuration.type,
    executable: resolvedCommand.executable,
    runtimeArgs: resolvedCommand.args.slice(
      0,
      resolvedCommand.args.length - configuration.args.length,
    ),
    args: [...configuration.args],
    workingDirectory: configuration.workingDirectory,
    environmentVariables: publicEnvironmentVariables(configuration),
    ...(configuration.environmentFile === undefined || environmentFileSnapshot === null
      ? {}
      : {
          environmentFile: configuration.environmentFile,
          environmentFileDigest: environmentFileSnapshot.digest,
        }),
    console: configuration.console,
  } as const;
  const risk = assessCommandRisk({
    executable: configuration.executable,
    args: configuredArgs,
    cwd,
    workspaceRoot: workspace.rootPath,
  });
  if (risk.level === 'blocked') {
    throw new RunExecutionServiceError('RUN_COMMAND_BLOCKED', risk.reasons.join(' '));
  }
  const executionId = randomUUID();
  return input.executions.create({
    id: executionId,
    workspaceId: input.workspaceId,
    configurationId: input.configurationId,
    ...(input.restartOfExecutionId === undefined
      ? {}
      : { restartOfExecutionId: input.restartOfExecutionId }),
    command,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    approvalDigest: runApprovalDigest({
      executionId,
      workspaceId: input.workspaceId,
      command,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
    }),
  });
}
