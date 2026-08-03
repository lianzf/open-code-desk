import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  ProjectTaskCommandSnapshot,
  ProjectTaskExecution,
  RunApprovalDecision,
  RunExecutionError,
  RunRiskLevel,
  RunStatus,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { projectTaskExecutions } from '../database/schema';

type ExecutionRow = typeof projectTaskExecutions.$inferSelect;

export interface CreateProjectTaskExecutionInput {
  readonly id?: string;
  readonly workspaceId: string;
  readonly rootTaskId: string;
  readonly restartOfExecutionId?: string;
  readonly plan: ReadonlyArray<ProjectTaskCommandSnapshot>;
  readonly status?: RunStatus;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
}

export interface UpdateProjectTaskExecutionInput {
  readonly status?: RunStatus;
  readonly approvalDecision?: RunApprovalDecision | null;
  readonly currentTaskId?: string | null;
  readonly currentTaskIndex?: number | null;
  readonly processId?: number | null;
  readonly outputTail?: string;
  readonly outputBytes?: number;
  readonly outputTruncated?: boolean;
  readonly exitCode?: number | null;
  readonly terminationSignal?: string | null;
  readonly error?: RunExecutionError | null;
  readonly approvalDecidedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

function assertSafePlan(plan: ReadonlyArray<ProjectTaskCommandSnapshot>): void {
  const ids = new Set<string>();
  for (const step of plan) {
    if (ids.has(step.taskId)) throw new Error('任务执行计划不能包含重复任务。');
    ids.add(step.taskId);
    for (const variable of step.environmentVariables) {
      if (variable.sensitive && variable.value !== undefined) {
        throw new Error(`敏感任务环境变量 ${variable.name} 不得写入执行历史。`);
      }
    }
  }
}

function toExecution(row: ExecutionRow): ProjectTaskExecution {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    rootTaskId: row.rootTaskId,
    ...(row.restartOfExecutionId === null
      ? {}
      : { restartOfExecutionId: row.restartOfExecutionId }),
    plan: row.planSnapshot,
    status: row.status,
    riskLevel: row.riskLevel,
    riskReasons: row.riskReasons,
    approvalDigest: row.approvalDigest,
    ...(row.approvalDecision === null ? {} : { approvalDecision: row.approvalDecision }),
    ...(row.currentTaskId === null ? {} : { currentTaskId: row.currentTaskId }),
    ...(row.currentTaskIndex === null ? {} : { currentTaskIndex: row.currentTaskIndex }),
    ...(row.processId === null ? {} : { processId: row.processId }),
    outputTail: row.outputTail,
    outputBytes: row.outputBytes,
    outputTruncated: row.outputTruncated,
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    ...(row.terminationSignal === null ? {} : { terminationSignal: row.terminationSignal }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.approvalDecidedAt === null ? {} : { approvalDecidedAt: row.approvalDecidedAt }),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  };
}

export class ProjectTaskExecutionRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(input: CreateProjectTaskExecutionInput): ProjectTaskExecution {
    assertSafePlan(input.plan);
    if (!input.plan.some((step) => step.taskId === input.rootTaskId)) {
      throw new Error('根任务不在执行计划中。');
    }
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(projectTaskExecutions)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        rootTaskId: input.rootTaskId,
        restartOfExecutionId: input.restartOfExecutionId ?? null,
        planSnapshot: input.plan,
        status: input.status ?? 'pending_approval',
        riskLevel: input.riskLevel,
        riskReasons: input.riskReasons,
        approvalDigest: input.approvalDigest,
        approvalDecision: null,
        currentTaskId: null,
        currentTaskIndex: null,
        processId: null,
        outputTail: '',
        outputBytes: 0,
        outputTruncated: false,
        exitCode: null,
        terminationSignal: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        approvalDecidedAt: null,
        startedAt: null,
        completedAt: null,
      })
      .returning()
      .get();
    return toExecution(row);
  }

  public findById(executionId: string): ProjectTaskExecution | null {
    const row = this.database.orm
      .select()
      .from(projectTaskExecutions)
      .where(eq(projectTaskExecutions.id, executionId))
      .get();
    return row === undefined ? null : toExecution(row);
  }

  public list(
    workspaceId: string,
    taskId?: string,
    limit = 100,
  ): ReadonlyArray<ProjectTaskExecution> {
    const condition =
      taskId === undefined
        ? eq(projectTaskExecutions.workspaceId, workspaceId)
        : and(
            eq(projectTaskExecutions.workspaceId, workspaceId),
            eq(projectTaskExecutions.rootTaskId, taskId),
          );
    return this.database.orm
      .select()
      .from(projectTaskExecutions)
      .where(condition)
      .orderBy(desc(projectTaskExecutions.createdAt), desc(projectTaskExecutions.id))
      .limit(limit)
      .all()
      .map(toExecution);
  }

  public update(
    executionId: string,
    update: UpdateProjectTaskExecutionInput,
  ): ProjectTaskExecution {
    const row = this.database.orm
      .update(projectTaskExecutions)
      .set({ ...update, updatedAt: new Date().toISOString() })
      .where(eq(projectTaskExecutions.id, executionId))
      .returning()
      .get();
    if (row === undefined) throw new Error('找不到项目任务执行记录。');
    return toExecution(row);
  }

  public recoverInterrupted(): number {
    const now = new Date().toISOString();
    const failed = this.database.orm
      .update(projectTaskExecutions)
      .set({
        status: 'failed',
        processId: null,
        error: {
          code: 'PROJECT_TASK_INTERRUPTED',
          message: '应用在任务完成前关闭。请重新运行该任务。',
          retryable: true,
        },
        updatedAt: now,
        completedAt: now,
      })
      .where(inArray(projectTaskExecutions.status, ['starting', 'running', 'stopping']))
      .run();
    return Number(failed.changes);
  }
}
