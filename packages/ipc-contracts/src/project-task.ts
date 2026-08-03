import { z } from 'zod';

import {
  runApprovalDecisionSchema,
  runEnvironmentVariableInputSchema,
  runEnvironmentVariableSchema,
  runExecutionErrorSchema,
  runRiskLevelSchema,
  runStatusSchema,
} from './run';

const uuidSchema = z.string().uuid();
const argumentSchema = z.string().max(32_768);
const relativePathSchema = z.string().max(2_048);

export const projectTaskChannels = {
  decideStart: 'project-tasks:decide-start',
  delete: 'project-tasks:delete',
  event: 'project-tasks:event',
  list: 'project-tasks:list',
  listHistory: 'project-tasks:list-history',
  proposeStart: 'project-tasks:propose-start',
  restart: 'project-tasks:restart',
  save: 'project-tasks:save',
  stop: 'project-tasks:stop',
} as const;

export const projectTaskTypeSchema = z.enum([
  'build',
  'clean',
  'test',
  'start',
  'package',
  'deploy',
  'lint',
  'typecheck',
  'custom',
]);

const taskFields = {
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(200),
  type: projectTaskTypeSchema,
  executable: z.string().trim().min(1).max(2_048),
  args: z.array(argumentSchema).max(500),
  workingDirectory: relativePathSchema,
  environmentVariables: z.array(runEnvironmentVariableSchema).max(500),
  dependsOn: z.array(uuidSchema).max(100),
  timeoutMs: z.number().int().min(1_000).max(86_400_000),
} as const;

export const projectTaskSchema = z
  .object({
    id: uuidSchema,
    ...taskFields,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((task, context) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      context.addIssue({
        code: 'custom',
        message: 'Task dependencies must be unique.',
        path: ['dependsOn'],
      });
    }
    if (task.dependsOn.includes(task.id)) {
      context.addIssue({
        code: 'custom',
        message: 'A task cannot depend on itself.',
        path: ['dependsOn'],
      });
    }
  });

export const projectTaskListSchema = z.array(projectTaskSchema).max(1_000);

export const listProjectTasksRequestSchema = z.object({ workspaceId: uuidSchema }).strict();

export const saveProjectTaskRequestSchema = z
  .object({
    id: uuidSchema.optional(),
    workspaceId: uuidSchema,
    name: taskFields.name,
    type: projectTaskTypeSchema,
    executable: taskFields.executable,
    args: z.array(argumentSchema).max(500).default([]),
    workingDirectory: relativePathSchema.default(''),
    environmentVariables: z.array(runEnvironmentVariableInputSchema).max(500).default([]),
    dependsOn: z.array(uuidSchema).max(100).default([]),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).default(600_000),
  })
  .strict()
  .superRefine((task, context) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      context.addIssue({
        code: 'custom',
        message: 'Task dependencies must be unique.',
        path: ['dependsOn'],
      });
    }
    if (task.id !== undefined && task.dependsOn.includes(task.id)) {
      context.addIssue({
        code: 'custom',
        message: 'A task cannot depend on itself.',
        path: ['dependsOn'],
      });
    }
  });

export const deleteProjectTaskRequestSchema = z
  .object({ workspaceId: uuidSchema, taskId: uuidSchema })
  .strict();
export const deleteProjectTaskResponseSchema = z.object({ deleted: z.boolean() }).strict();

export const projectTaskCommandSnapshotSchema = z
  .object({
    taskId: uuidSchema,
    taskUpdatedAt: z.string().datetime(),
    taskName: z.string().trim().min(1).max(200),
    taskType: projectTaskTypeSchema,
    executable: taskFields.executable,
    args: z.array(argumentSchema).max(500),
    workingDirectory: relativePathSchema,
    environmentVariables: z.array(runEnvironmentVariableSchema).max(500),
    timeoutMs: z.number().int().min(1_000).max(86_400_000),
    riskLevel: runRiskLevelSchema,
    riskReasons: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

export const projectTaskExecutionSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    rootTaskId: uuidSchema,
    restartOfExecutionId: uuidSchema.optional(),
    plan: z.array(projectTaskCommandSnapshotSchema).min(1).max(100),
    status: runStatusSchema,
    riskLevel: runRiskLevelSchema,
    riskReasons: z.array(z.string().trim().min(1).max(1_000)).max(100),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
    approvalDecision: runApprovalDecisionSchema.optional(),
    currentTaskId: uuidSchema.optional(),
    currentTaskIndex: z.number().int().nonnegative().optional(),
    processId: z.number().int().positive().optional(),
    outputTail: z.string().max(65_536),
    outputBytes: z.number().int().nonnegative(),
    outputTruncated: z.boolean(),
    exitCode: z.number().int().optional(),
    terminationSignal: z.string().trim().min(1).max(100).optional(),
    error: runExecutionErrorSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    approvalDecidedAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((execution, context) => {
    const taskIds = execution.plan.map((step) => step.taskId);
    if (new Set(taskIds).size !== taskIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Task execution plans cannot contain duplicates.',
        path: ['plan'],
      });
    }
    if (!taskIds.includes(execution.rootTaskId)) {
      context.addIssue({
        code: 'custom',
        message: 'The root task must be present in the plan.',
        path: ['rootTaskId'],
      });
    }
    if (execution.currentTaskId !== undefined && !taskIds.includes(execution.currentTaskId)) {
      context.addIssue({
        code: 'custom',
        message: 'The current task must be present in the plan.',
        path: ['currentTaskId'],
      });
    }
  });

export const projectTaskExecutionListSchema = z.array(projectTaskExecutionSchema).max(1_000);
export const pendingProjectTaskExecutionSchema = projectTaskExecutionSchema.refine(
  (execution) => execution.status === 'pending_approval',
  'Expected a pending task execution.',
);

export const proposeProjectTaskStartRequestSchema = z
  .object({ workspaceId: uuidSchema, taskId: uuidSchema })
  .strict();
export const decideProjectTaskStartRequestSchema = z
  .object({
    executionId: uuidSchema,
    decision: runApprovalDecisionSchema,
    expectedApprovalDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
  })
  .strict();
export const projectTaskExecutionIdRequestSchema = z.object({ executionId: uuidSchema }).strict();
export const listProjectTaskHistoryRequestSchema = z
  .object({
    workspaceId: uuidSchema,
    taskId: uuidSchema.optional(),
    limit: z.number().int().min(1).max(1_000).default(100),
  })
  .strict();

export const projectTaskOutputEventSchema = z
  .object({
    type: z.literal('output'),
    executionId: uuidSchema,
    workspaceId: uuidSchema,
    taskId: uuidSchema,
    stream: z.enum(['stdout', 'stderr']),
    sequence: z.number().int().nonnegative(),
    data: z.string().max(65_536),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const projectTaskStatusEventSchema = z
  .object({
    type: z.literal('status'),
    execution: projectTaskExecutionSchema,
    previousStatus: runStatusSchema.optional(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const projectTaskEventSchema = z.discriminatedUnion('type', [
  projectTaskOutputEventSchema,
  projectTaskStatusEventSchema,
]);

export type ProjectTask = z.infer<typeof projectTaskSchema>;
export type ProjectTaskType = z.infer<typeof projectTaskTypeSchema>;
export type SaveProjectTaskRequest = z.infer<typeof saveProjectTaskRequestSchema>;
export type DeleteProjectTaskRequest = z.infer<typeof deleteProjectTaskRequestSchema>;
export type ProposeProjectTaskStartRequest = z.infer<typeof proposeProjectTaskStartRequestSchema>;
export type DecideProjectTaskStartRequest = z.infer<typeof decideProjectTaskStartRequestSchema>;
export type ProjectTaskExecutionIdRequest = z.infer<typeof projectTaskExecutionIdRequestSchema>;
export type ListProjectTaskHistoryRequest = z.infer<typeof listProjectTaskHistoryRequestSchema>;
export type ProjectTaskExecution = z.infer<typeof projectTaskExecutionSchema>;
export type ProjectTaskEvent = z.infer<typeof projectTaskEventSchema>;
