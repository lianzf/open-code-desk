import { and, asc, eq } from 'drizzle-orm';
import type { ProjectTask, RunEnvironmentVariable } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { projectTasks, type StoredRunEnvironmentVariable } from '../database/schema';

export interface StoredProjectTask extends Omit<ProjectTask, 'environmentVariables'> {
  readonly environmentVariables: ReadonlyArray<StoredRunEnvironmentVariable>;
}

export type SaveStoredProjectTask = Omit<StoredProjectTask, 'createdAt' | 'updatedAt'>;
type ProjectTaskRow = typeof projectTasks.$inferSelect;

function assertSafeEnvironment(variables: ReadonlyArray<StoredRunEnvironmentVariable>): void {
  const names = new Set<string>();
  for (const variable of variables) {
    if (names.has(variable.name)) throw new Error(`任务环境变量 ${variable.name} 重复。`);
    names.add(variable.name);
    if (variable.sensitive) {
      if (variable.value !== undefined)
        throw new Error(`敏感任务环境变量 ${variable.name} 不得保存明文。`);
      if (variable.configured !== (variable.secretRef !== undefined)) {
        throw new Error(`敏感任务环境变量 ${variable.name} 的凭据引用无效。`);
      }
    } else if (
      variable.secretRef !== undefined ||
      variable.configured !== (variable.value !== undefined)
    ) {
      throw new Error(`任务环境变量 ${variable.name} 的存储状态无效。`);
    }
  }
}

function publicEnvironment(variable: StoredRunEnvironmentVariable): RunEnvironmentVariable {
  return {
    name: variable.name,
    sensitive: variable.sensitive,
    configured: variable.configured,
    ...(!variable.sensitive && variable.value !== undefined ? { value: variable.value } : {}),
  };
}

function toStoredTask(row: ProjectTaskRow): StoredProjectTask {
  assertSafeEnvironment(row.environmentVariables);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type,
    executable: row.executable,
    args: row.args,
    workingDirectory: row.workingDirectory,
    environmentVariables: row.environmentVariables,
    dependsOn: row.dependsOn,
    timeoutMs: row.timeoutMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicTask(task: StoredProjectTask): ProjectTask {
  return { ...task, environmentVariables: task.environmentVariables.map(publicEnvironment) };
}

export class ProjectTaskRepository {
  public constructor(private readonly database: AppDatabase) {}

  public findStoredById(taskId: string): StoredProjectTask | null {
    const row = this.database.orm
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.id, taskId))
      .get();
    return row === undefined ? null : toStoredTask(row);
  }

  public findById(taskId: string): ProjectTask | null {
    const task = this.findStoredById(taskId);
    return task === null ? null : toPublicTask(task);
  }

  public listStored(workspaceId: string): ReadonlyArray<StoredProjectTask> {
    return this.database.orm
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.workspaceId, workspaceId))
      .orderBy(asc(projectTasks.name), asc(projectTasks.id))
      .all()
      .map(toStoredTask);
  }

  public list(workspaceId: string): ReadonlyArray<ProjectTask> {
    return this.listStored(workspaceId).map(toPublicTask);
  }

  public save(input: SaveStoredProjectTask): ProjectTask {
    assertSafeEnvironment(input.environmentVariables);
    const existing = this.findStoredById(input.id);
    if (existing !== null && existing.workspaceId !== input.workspaceId) {
      throw new Error('项目任务不能移动到其他工作区。');
    }
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(projectTasks)
      .values({ ...input, createdAt: existing?.createdAt ?? now, updatedAt: now })
      .onConflictDoUpdate({
        target: projectTasks.id,
        set: {
          name: input.name,
          type: input.type,
          executable: input.executable,
          args: input.args,
          workingDirectory: input.workingDirectory,
          environmentVariables: input.environmentVariables,
          dependsOn: input.dependsOn,
          timeoutMs: input.timeoutMs,
          updatedAt: now,
        },
      })
      .returning()
      .get();
    return toPublicTask(toStoredTask(row));
  }

  public delete(workspaceId: string, taskId: string): boolean {
    return (
      this.database.orm
        .delete(projectTasks)
        .where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.id, taskId)))
        .returning({ id: projectTasks.id })
        .get() !== undefined
    );
  }
}
