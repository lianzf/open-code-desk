import type {
  ProjectTaskCommandSnapshot,
  ProjectTaskPlanSnapshot,
  RunRiskLevel,
} from '@open-code-desk/domain';

import { assessCommandRisk } from '../commands/command-risk-policy';
import {
  publicEnvironmentVariables,
  resolveRunWorkingDirectory,
} from '../run/run-execution-policy';
import { resolveStructuredSpawnCommand } from '../run/run-process-runtime';
import type { WorkspaceService } from '../workspace/workspace.service';
import { ProjectTaskExecutionServiceError } from './project-task-execution-errors';
import type { ProjectTaskRepository, StoredProjectTask } from './project-task.repository';

const riskRank: Readonly<Record<RunRiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  blocked: 3,
};

export class ProjectTaskPlanBuilder {
  public constructor(
    private readonly tasks: ProjectTaskRepository,
    private readonly workspaces: WorkspaceService,
  ) {}

  public async prepare(workspaceId: string, rootTaskId: string): Promise<ProjectTaskPlanSnapshot> {
    const rootTask = this.tasks.findStoredById(rootTaskId);
    if (rootTask === null || rootTask.workspaceId !== workspaceId) {
      throw new ProjectTaskExecutionServiceError(
        'PROJECT_TASK_NOT_FOUND',
        '找不到当前工作区的项目任务。',
      );
    }
    const workspace = await this.workspaces.getById(workspaceId);
    const orderedTasks = this.resolvePlan(workspaceId, rootTaskId);
    const plan: ProjectTaskCommandSnapshot[] = [];
    for (const task of orderedTasks) {
      const cwd = await resolveRunWorkingDirectory(workspace.rootPath, task.workingDirectory);
      const resolved = await resolveStructuredSpawnCommand(task.executable, task.args);
      const risk = assessCommandRisk({
        executable: task.executable,
        args: task.args,
        cwd,
        workspaceRoot: workspace.rootPath,
      });
      if (risk.level === 'blocked') {
        throw new ProjectTaskExecutionServiceError(
          'PROJECT_TASK_COMMAND_BLOCKED',
          `${task.name}: ${risk.reasons.join(' ')}`,
        );
      }
      plan.push({
        taskId: task.id,
        taskUpdatedAt: task.updatedAt,
        taskName: task.name,
        taskType: task.type,
        executable: resolved.executable,
        args: resolved.args,
        workingDirectory: task.workingDirectory,
        environmentVariables: publicEnvironmentVariables(task),
        timeoutMs: task.timeoutMs,
        riskLevel: risk.level,
        riskReasons: risk.reasons,
      });
    }
    const riskLevel = plan.reduce<RunRiskLevel>(
      (highest, step) => (riskRank[step.riskLevel] > riskRank[highest] ? step.riskLevel : highest),
      'low',
    );
    return {
      rootTaskId,
      plan,
      riskLevel,
      riskReasons: plan
        .flatMap((step) => step.riskReasons.map((reason) => `${step.taskName}: ${reason}`))
        .slice(0, 100),
    };
  }

  private resolvePlan(workspaceId: string, rootTaskId: string): ReadonlyArray<StoredProjectTask> {
    const available = new Map(this.tasks.listStored(workspaceId).map((task) => [task.id, task]));
    const ordered: StoredProjectTask[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (taskId: string): void => {
      if (visiting.has(taskId)) {
        throw new ProjectTaskExecutionServiceError(
          'PROJECT_TASK_DEPENDENCY_CYCLE',
          '项目任务依赖形成循环。',
        );
      }
      if (visited.has(taskId)) return;
      const task = available.get(taskId);
      if (task === undefined) {
        throw new ProjectTaskExecutionServiceError(
          'PROJECT_TASK_DEPENDENCY_MISSING',
          '项目任务引用了当前工作区中不存在的依赖。',
        );
      }
      visiting.add(taskId);
      task.dependsOn.forEach(visit);
      visiting.delete(taskId);
      visited.add(taskId);
      ordered.push(task);
    };
    visit(rootTaskId);
    return ordered;
  }
}
