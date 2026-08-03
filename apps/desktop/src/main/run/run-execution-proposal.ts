import { randomUUID } from 'node:crypto';

import type {
  ProjectTaskPlanSnapshot,
  RunCommandSnapshot,
  RunExecution,
  RunRiskLevel,
} from '@open-code-desk/domain';

import { assessCommandRisk } from '../commands/command-risk-policy';
import { assessDebugAttachRisk } from '../debug/debug-attach-policy';
import { assessElectronDebugRisk } from '../debug/electron/electron-debug-policy';
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

export interface ProjectTaskPlanProvider {
  preparePlan(workspaceId: string, rootTaskId: string): Promise<ProjectTaskPlanSnapshot>;
}

const riskRank: Readonly<Record<RunRiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  blocked: 3,
};

export async function createRunProposal(input: {
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly restartOfExecutionId?: string;
  readonly configurations: RunConfigurationRepository;
  readonly executions: RunExecutionRepository;
  readonly workspaces: WorkspaceService;
  readonly taskPlans?: ProjectTaskPlanProvider;
}): Promise<RunExecution> {
  const prepared = await prepareRunProposal(input);
  const executionId = randomUUID();
  return input.executions.create({
    id: executionId,
    workspaceId: input.workspaceId,
    configurationId: input.configurationId,
    ...(input.restartOfExecutionId === undefined
      ? {}
      : { restartOfExecutionId: input.restartOfExecutionId }),
    command: prepared.command,
    riskLevel: prepared.riskLevel,
    riskReasons: prepared.riskReasons,
    approvalDigest: runApprovalDigest({
      executionId,
      workspaceId: input.workspaceId,
      command: prepared.command,
      riskLevel: prepared.riskLevel,
      riskReasons: prepared.riskReasons,
    }),
  });
}

export interface PreparedRunProposal {
  readonly command: RunCommandSnapshot;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
}

export async function prepareRunProposal(input: {
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly configurations: RunConfigurationRepository;
  readonly workspaces: WorkspaceService;
  readonly taskPlans?: ProjectTaskPlanProvider;
  readonly purpose?: 'run' | 'debug';
}): Promise<PreparedRunProposal> {
  const configuration = input.configurations.findStoredById(input.configurationId);
  if (configuration === null || configuration.workspaceId !== input.workspaceId) {
    throw new RunExecutionServiceError(
      'RUN_CONFIGURATION_NOT_FOUND',
      '找不到当前工作区的运行配置。',
    );
  }
  if (
    (configuration.preLaunchTaskId !== undefined || configuration.postRunTaskId !== undefined) &&
    input.taskPlans === undefined
  ) {
    throw new RunExecutionServiceError('RUN_TASKS_NOT_SUPPORTED', '运行服务未配置项目任务执行器。');
  }
  if (configuration.debugAttach !== undefined && input.purpose !== 'debug') {
    throw new RunExecutionServiceError(
      'RUN_DEBUG_ONLY_CONFIGURATION',
      '该配置用于附加远程或容器调试目标，不能作为普通运行配置启动。',
    );
  }
  const workspace = await input.workspaces.getById(input.workspaceId);
  const cwd = await resolveRunWorkingDirectory(workspace.rootPath, configuration.workingDirectory);
  const environmentFileSnapshot =
    configuration.environmentFile === undefined
      ? null
      : await readEnvironmentFile(workspace.rootPath, configuration.environmentFile);
  const configuredArgs = [...configuration.runtimeArgs, ...configuration.args];
  const resolvedCommand =
    configuration.debugAttach === undefined
      ? await resolveStructuredSpawnCommand(configuration.executable, configuredArgs)
      : { executable: configuration.executable, args: configuredArgs };
  const [preLaunchTaskPlan, postRunTaskPlan] = await Promise.all([
    configuration.preLaunchTaskId === undefined
      ? Promise.resolve(undefined)
      : input.taskPlans?.preparePlan(input.workspaceId, configuration.preLaunchTaskId),
    configuration.postRunTaskId === undefined
      ? Promise.resolve(undefined)
      : input.taskPlans?.preparePlan(input.workspaceId, configuration.postRunTaskId),
  ]);
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
    ...(preLaunchTaskPlan === undefined ? {} : { preLaunchTaskPlan }),
    ...(postRunTaskPlan === undefined ? {} : { postRunTaskPlan }),
    ...(configuration.debugAttach === undefined ? {} : { debugAttach: configuration.debugAttach }),
    ...(configuration.port === undefined ? {} : { port: configuration.port }),
    console: configuration.console,
  } as const;
  const risk =
    configuration.debugAttach === undefined
      ? assessCommandRisk({
          executable: configuration.executable,
          args: configuredArgs,
          cwd,
          workspaceRoot: workspace.rootPath,
        })
      : assessDebugAttachRisk(configuration.debugAttach);
  if (risk.level === 'blocked') {
    throw new RunExecutionServiceError('RUN_COMMAND_BLOCKED', risk.reasons.join(' '));
  }
  const hookPlans = [preLaunchTaskPlan, postRunTaskPlan].filter(
    (plan): plan is ProjectTaskPlanSnapshot => plan !== undefined,
  );
  const electronDebugRisk =
    input.purpose === 'debug' &&
    configuration.type === 'electron' &&
    configuration.port !== undefined
      ? assessElectronDebugRisk(configuration.port)
      : undefined;
  const commandRiskLevel =
    electronDebugRisk !== undefined && riskRank[electronDebugRisk.level] > riskRank[risk.level]
      ? electronDebugRisk.level
      : risk.level;
  const riskLevel = hookPlans.reduce<RunRiskLevel>(
    (highest, plan) => (riskRank[plan.riskLevel] > riskRank[highest] ? plan.riskLevel : highest),
    commandRiskLevel,
  );
  return {
    command,
    riskLevel,
    riskReasons: [
      ...risk.reasons,
      ...(electronDebugRisk?.reasons ?? []),
      ...(preLaunchTaskPlan?.riskReasons.map((reason) => `启动前任务：${reason}`) ?? []),
      ...(postRunTaskPlan?.riskReasons.map((reason) => `启动后任务：${reason}`) ?? []),
    ].slice(0, 100),
  };
}
