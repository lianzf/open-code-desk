import { z } from 'zod';

import {
  debugAttachConfigurationSchema,
  projectTypeSchema,
  runConsoleSchema,
  runEnvironmentVariableSchema,
} from './run-common';
import { argumentSchema, relativePathSchema, uuidSchema, workspaceIdSchema } from './run-internal';

export const runStatusSchema = z.enum([
  'pending_approval',
  'starting',
  'running',
  'stopping',
  'stopped',
  'completed',
  'failed',
  'rejected',
]);

export const runRiskLevelSchema = z.enum(['low', 'medium', 'high', 'blocked']);
export const runApprovalDecisionSchema = z.enum(['approve', 'reject']);
export const runOutputStreamSchema = z.enum(['stdout', 'stderr']);

export const runTaskHookCommandSnapshotSchema = z
  .object({
    taskId: uuidSchema,
    taskUpdatedAt: z.string().datetime(),
    taskName: z.string().trim().min(1).max(200),
    taskType: z.enum([
      'build',
      'clean',
      'test',
      'start',
      'package',
      'deploy',
      'lint',
      'typecheck',
      'custom',
    ]),
    executable: z.string().trim().min(1).max(2_048),
    args: z.array(argumentSchema).max(500),
    workingDirectory: relativePathSchema,
    environmentVariables: z.array(runEnvironmentVariableSchema).max(500),
    timeoutMs: z.number().int().min(1_000).max(86_400_000),
    riskLevel: runRiskLevelSchema,
    riskReasons: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

export const runTaskHookPlanSnapshotSchema = z
  .object({
    rootTaskId: uuidSchema,
    plan: z.array(runTaskHookCommandSnapshotSchema).min(1).max(100),
    riskLevel: runRiskLevelSchema,
    riskReasons: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const taskIds = snapshot.plan.map((step) => step.taskId);
    if (new Set(taskIds).size !== taskIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Task hook plans cannot contain duplicates.',
        path: ['plan'],
      });
    }
    if (!taskIds.includes(snapshot.rootTaskId)) {
      context.addIssue({
        code: 'custom',
        message: 'The hook root task must be present in the plan.',
        path: ['rootTaskId'],
      });
    }
  });

export const runCommandSnapshotSchema = z
  .object({
    configurationId: uuidSchema,
    configurationUpdatedAt: z.string().datetime(),
    configurationName: z.string().trim().min(1).max(200),
    projectType: projectTypeSchema,
    executable: z.string().trim().min(1).max(2_048),
    runtimeArgs: z.array(argumentSchema).max(500),
    args: z.array(argumentSchema).max(500),
    workingDirectory: relativePathSchema,
    environmentVariables: z.array(runEnvironmentVariableSchema).max(500),
    environmentFile: relativePathSchema.min(1).optional(),
    environmentFileDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 digest.')
      .optional(),
    preLaunchTaskPlan: runTaskHookPlanSnapshotSchema.optional(),
    postRunTaskPlan: runTaskHookPlanSnapshotSchema.optional(),
    debugAttach: debugAttachConfigurationSchema.optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    console: runConsoleSchema,
  })
  .strict();

export const runExecutionErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

const runExecutionFields = {
  id: uuidSchema,
  workspaceId: workspaceIdSchema,
  configurationId: uuidSchema,
  restartOfExecutionId: uuidSchema.optional(),
  command: runCommandSnapshotSchema,
  riskLevel: runRiskLevelSchema,
  riskReasons: z.array(z.string().trim().min(1).max(1_000)).max(100),
  approvalDigest: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 digest.'),
  approvalDecision: runApprovalDecisionSchema.optional(),
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
} as const;

const runExecutionBaseSchema = z.object(runExecutionFields).strict();

export const runExecutionSchema = runExecutionBaseSchema
  .extend({ status: runStatusSchema })
  .superRefine((execution, context) => {
    if (execution.command.configurationId !== execution.configurationId) {
      context.addIssue({
        code: 'custom',
        message: 'The command snapshot must belong to the execution configuration.',
        path: ['command', 'configurationId'],
      });
    }
    if (execution.status === 'pending_approval' && execution.approvalDecision !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A pending execution cannot already have an approval decision.',
        path: ['approvalDecision'],
      });
    }
    if (execution.status === 'rejected' && execution.approvalDecision !== 'reject') {
      context.addIssue({
        code: 'custom',
        message: 'A rejected execution must record a reject decision.',
        path: ['approvalDecision'],
      });
    }
    if (
      ['starting', 'running', 'stopping', 'stopped', 'completed', 'failed'].includes(
        execution.status,
      ) &&
      execution.approvalDecision !== 'approve'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An execution cannot start without an approve decision.',
        path: ['approvalDecision'],
      });
    }
  });

/** Start and restart proposals are incapable of representing an already-started execution. */
export const pendingRunExecutionSchema = runExecutionBaseSchema
  .extend({ status: z.literal('pending_approval') })
  .superRefine((execution, context) => {
    if (execution.command.configurationId !== execution.configurationId) {
      context.addIssue({
        code: 'custom',
        message: 'The command snapshot must belong to the execution configuration.',
        path: ['command', 'configurationId'],
      });
    }
    if (execution.approvalDecision !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A pending execution cannot already have an approval decision.',
        path: ['approvalDecision'],
      });
    }
  });

export const runExecutionListSchema = z.array(runExecutionSchema).max(1_000);

export const proposeRunStartRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, configurationId: uuidSchema })
  .strict();

export const decideRunStartRequestSchema = z
  .object({
    executionId: uuidSchema,
    expectedApprovalDigest: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 digest.'),
    decision: runApprovalDecisionSchema,
  })
  .strict();

export const stopRunExecutionRequestSchema = z.object({ executionId: uuidSchema }).strict();
export const restartRunExecutionRequestSchema = z.object({ executionId: uuidSchema }).strict();

export const listRunHistoryRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    configurationId: uuidSchema.optional(),
    limit: z.number().int().min(1).max(1_000).default(100),
  })
  .strict();

export const inspectRunPortRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, port: z.number().int().min(1).max(65_535) })
  .strict();

export const runPortInspectionSchema = z
  .object({
    port: z.number().int().min(1).max(65_535),
    available: z.boolean(),
    processId: z.number().int().positive().optional(),
    processName: z.string().trim().min(1).max(512).optional(),
    managedExecutionId: uuidSchema.optional(),
  })
  .strict();

export const terminateRunPortProcessRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    port: z.number().int().min(1).max(65_535),
    expectedProcessId: z.number().int().positive(),
    confirmed: z.literal(true),
  })
  .strict();

export const runOutputEventSchema = z
  .object({
    type: z.literal('output'),
    executionId: uuidSchema,
    workspaceId: workspaceIdSchema,
    stream: runOutputStreamSchema,
    sequence: z.number().int().nonnegative(),
    data: z.string().max(65_536),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const runStatusEventSchema = z
  .object({
    type: z.literal('status'),
    execution: runExecutionSchema,
    previousStatus: runStatusSchema.optional(),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const runEventSchema = z.discriminatedUnion('type', [
  runOutputEventSchema,
  runStatusEventSchema,
]);

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunRiskLevel = z.infer<typeof runRiskLevelSchema>;
export type RunApprovalDecision = z.infer<typeof runApprovalDecisionSchema>;
export type RunOutputStream = z.infer<typeof runOutputStreamSchema>;
export type RunCommandSnapshot = z.infer<typeof runCommandSnapshotSchema>;
export type RunExecutionError = z.infer<typeof runExecutionErrorSchema>;
export type RunExecution = z.infer<typeof runExecutionSchema>;
export type PendingRunExecution = z.infer<typeof pendingRunExecutionSchema>;
export type ProposeRunStartRequest = z.infer<typeof proposeRunStartRequestSchema>;
export type DecideRunStartRequest = z.infer<typeof decideRunStartRequestSchema>;
export type StopRunExecutionRequest = z.infer<typeof stopRunExecutionRequestSchema>;
export type RestartRunExecutionRequest = z.infer<typeof restartRunExecutionRequestSchema>;
export type ListRunHistoryRequest = z.infer<typeof listRunHistoryRequestSchema>;
export type InspectRunPortRequest = z.infer<typeof inspectRunPortRequestSchema>;
export type RunPortInspection = z.infer<typeof runPortInspectionSchema>;
export type TerminateRunPortProcessRequest = z.infer<typeof terminateRunPortProcessRequestSchema>;
export type RunOutputEvent = z.infer<typeof runOutputEventSchema>;
export type RunStatusEvent = z.infer<typeof runStatusEventSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
