import { randomUUID } from 'node:crypto';

import type { ProjectTask } from '@open-code-desk/domain';
import type {
  DeleteProjectTaskRequest,
  SaveProjectTaskRequest,
} from '@open-code-desk/ipc-contracts';

import type { StoredRunEnvironmentVariable } from '../database/schema';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import type { SecretStore } from '../security/secret-store';
import type { ProjectTaskRepository, StoredProjectTask } from './project-task.repository';

export class ProjectTaskServiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectTaskServiceError';
  }
}

function refs(task: StoredProjectTask | null): ReadonlySet<string> {
  return new Set(
    task?.environmentVariables.flatMap((variable) =>
      variable.secretRef === undefined ? [] : [variable.secretRef],
    ) ?? [],
  );
}

export class ProjectTaskService {
  public constructor(
    private readonly tasks: ProjectTaskRepository,
    private readonly secrets: SecretStore,
    private readonly configurations?: RunConfigurationRepository,
  ) {}

  public list(workspaceId: string): ReadonlyArray<ProjectTask> {
    return this.tasks.list(workspaceId);
  }

  public async save(input: SaveProjectTaskRequest): Promise<ProjectTask> {
    const taskId = input.id ?? randomUUID();
    const existing = this.tasks.findStoredById(taskId);
    if (existing !== null && existing.workspaceId !== input.workspaceId) {
      throw new ProjectTaskServiceError('项目任务不属于当前工作区。');
    }
    this.validateDependencies(input.workspaceId, taskId, input.dependsOn);
    const prepared = await this.prepareEnvironment(taskId, input, existing);
    try {
      const saved = this.tasks.save({
        id: taskId,
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        executable: input.executable,
        args: input.args,
        workingDirectory: input.workingDirectory,
        environmentVariables: prepared.variables,
        dependsOn: input.dependsOn,
        timeoutMs: input.timeoutMs,
      });
      const retained = new Set(
        prepared.variables.flatMap((variable) =>
          variable.secretRef === undefined ? [] : [variable.secretRef],
        ),
      );
      await this.deleteSecrets([...refs(existing)].filter((ref) => !retained.has(ref)));
      return saved;
    } catch (error) {
      await this.deleteSecrets(prepared.createdRefs);
      throw error;
    }
  }

  public async delete(input: DeleteProjectTaskRequest): Promise<boolean> {
    const existing = this.tasks.findStoredById(input.taskId);
    if (existing === null || existing.workspaceId !== input.workspaceId) return false;
    const dependent = this.tasks
      .list(input.workspaceId)
      .find((task) => task.dependsOn.includes(input.taskId));
    if (dependent !== undefined) {
      throw new ProjectTaskServiceError(`任务“${dependent.name}”仍依赖该任务，请先移除依赖。`);
    }
    const configuration = this.configurations
      ?.list(input.workspaceId)
      .find((item) => item.preLaunchTaskId === input.taskId || item.postRunTaskId === input.taskId);
    if (configuration !== undefined) {
      throw new ProjectTaskServiceError(`运行配置“${configuration.name}”仍引用该任务。`);
    }
    const deleted = this.tasks.delete(input.workspaceId, input.taskId);
    if (deleted) await this.deleteSecrets([...refs(existing)]);
    return deleted;
  }

  private validateDependencies(
    workspaceId: string,
    taskId: string,
    dependencyIds: ReadonlyArray<string>,
  ): void {
    if (dependencyIds.includes(taskId)) throw new ProjectTaskServiceError('项目任务不能依赖自身。');
    const tasks = new Map(this.tasks.list(workspaceId).map((task) => [task.id, task]));
    for (const dependencyId of dependencyIds) {
      if (!tasks.has(dependencyId))
        throw new ProjectTaskServiceError('项目任务依赖必须属于当前工作区。');
    }
    const candidate = { id: taskId, dependsOn: dependencyIds };
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new ProjectTaskServiceError('项目任务依赖形成循环。');
      if (visited.has(id)) return;
      visiting.add(id);
      const dependencies = id === taskId ? candidate.dependsOn : (tasks.get(id)?.dependsOn ?? []);
      dependencies.forEach(visit);
      visiting.delete(id);
      visited.add(id);
    };
    visit(taskId);
  }

  private async prepareEnvironment(
    taskId: string,
    input: SaveProjectTaskRequest,
    existing: StoredProjectTask | null,
  ): Promise<{
    readonly variables: ReadonlyArray<StoredRunEnvironmentVariable>;
    readonly createdRefs: ReadonlyArray<string>;
  }> {
    const existingByName = new Map(
      existing?.environmentVariables.map((variable) => [variable.name, variable]) ?? [],
    );
    const names = new Set<string>();
    const variables: StoredRunEnvironmentVariable[] = [];
    const createdRefs: string[] = [];
    try {
      for (const variable of input.environmentVariables) {
        if (names.has(variable.name))
          throw new ProjectTaskServiceError(`任务环境变量 ${variable.name} 重复。`);
        names.add(variable.name);
        if (!variable.sensitive) {
          variables.push({
            name: variable.name,
            sensitive: false,
            configured: variable.value !== undefined,
            ...(variable.value === undefined ? {} : { value: variable.value }),
          });
          continue;
        }
        if (variable.value === undefined) {
          const previous = existingByName.get(variable.name);
          const secretRef = previous?.sensitive === true ? previous.secretRef : undefined;
          variables.push({
            name: variable.name,
            sensitive: true,
            configured: secretRef !== undefined,
            ...(secretRef === undefined ? {} : { secretRef }),
          });
          continue;
        }
        const secretRef = `project-task:${taskId}:env:${randomUUID()}`;
        await this.secrets.set(secretRef, variable.value);
        createdRefs.push(secretRef);
        variables.push({ name: variable.name, sensitive: true, configured: true, secretRef });
      }
      return { variables, createdRefs };
    } catch (error) {
      await this.deleteSecrets(createdRefs);
      throw error;
    }
  }

  private async deleteSecrets(secretRefs: ReadonlyArray<string>): Promise<void> {
    await Promise.allSettled(secretRefs.map((ref) => this.secrets.delete(ref)));
  }
}
