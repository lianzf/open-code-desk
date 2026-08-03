import { z } from 'zod';

import { runCommandSnapshotSchema, runRiskLevelSchema } from '../run';
import {
  dapReferenceSchema,
  relativePathSchema,
  sessionIdSchema,
  uuidSchema,
  workspaceIdSchema,
} from './debug-internal';

export const debugSessionStatusSchema = z.enum([
  'pending_approval',
  'starting',
  'running',
  'paused',
  'stopping',
  'stopped',
  'completed',
  'failed',
  'rejected',
]);

export const debugBreakpointStatusSchema = z.enum([
  'pending',
  'verified',
  'unverified',
  'disabled',
  'error',
]);

export const debugAdapterCapabilitiesSchema = z
  .object({
    pause: z.boolean(),
    restart: z.boolean(),
    stepBack: z.boolean(),
    setVariable: z.boolean(),
    conditionalBreakpoints: z.boolean(),
    hitConditionalBreakpoints: z.boolean().default(false),
    logPoints: z.boolean().default(false),
    functionBreakpoints: z.boolean(),
    dataBreakpoints: z.boolean().default(false),
    exceptionInfo: z.boolean(),
  })
  .strict();

export const debugPauseLocationSchema = z
  .object({
    threadId: dapReferenceSchema,
    reason: z.string().min(1).max(200),
    description: z.string().max(2_000).optional(),
    relativePath: relativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    frameId: z.number().int().nonnegative().optional(),
    exception: z
      .object({
        exceptionId: z.string().min(1).max(1_000),
        description: z.string().max(4_000).optional(),
        breakMode: z.string().max(100).optional(),
        typeName: z.string().max(1_000).optional(),
        message: z.string().max(8_000).optional(),
        stackTrace: z.string().max(32_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const debugSessionErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

export const debugSessionSchema = z
  .object({
    id: sessionIdSchema,
    workspaceId: workspaceIdSchema,
    configurationId: uuidSchema,
    adapterType: z.string().min(1).max(100),
    command: runCommandSnapshotSchema,
    status: debugSessionStatusSchema,
    riskLevel: runRiskLevelSchema,
    riskReasons: z.array(z.string().min(1).max(1_000)).max(20),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
    approvalDecision: z.enum(['approve', 'reject']).optional(),
    adapterProcessId: z.number().int().positive().optional(),
    capabilities: debugAdapterCapabilitiesSchema.optional(),
    pause: debugPauseLocationSchema.optional(),
    outputTail: z.string().max(65_536),
    outputBytes: z.number().int().nonnegative(),
    error: debugSessionErrorSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    approvalDecidedAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const debugBreakpointSchema = z
  .object({
    id: uuidSchema,
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema,
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    enabled: z.boolean(),
    kind: z.enum(['line', 'function', 'data']),
    functionName: z.string().min(1).max(1_000).optional(),
    dataId: z.string().min(1).max(4_000).optional(),
    dataAccessType: z.enum(['read', 'write', 'readWrite']).optional(),
    condition: z.string().max(4_000).optional(),
    hitCondition: z.string().max(1_000).optional(),
    logMessage: z.string().max(4_000).optional(),
    status: debugBreakpointStatusSchema,
    adapterBreakpointId: z.number().int().nonnegative().optional(),
    message: z.string().max(2_000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const debugThreadSchema = z
  .object({ id: dapReferenceSchema, name: z.string().min(1).max(500) })
  .strict();

export const debugStackFrameSchema = z
  .object({
    id: z.number().int().nonnegative(),
    name: z.string().min(1).max(1_000),
    sourceName: z.string().max(1_000).optional(),
    relativePath: relativePathSchema.optional(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  })
  .strict();

export const debugScopeSchema = z
  .object({
    name: z.string().min(1).max(500),
    variablesReference: dapReferenceSchema,
    expensive: z.boolean(),
  })
  .strict();

export const debugVariableSchema = z
  .object({
    name: z.string().min(1).max(1_000),
    value: z.string().max(65_536),
    type: z.string().max(500).optional(),
    variablesReference: dapReferenceSchema,
    evaluateName: z.string().max(4_000).optional(),
  })
  .strict();

export const debugWatchExpressionSchema = z
  .object({
    id: uuidSchema,
    workspaceId: workspaceIdSchema,
    expression: z.string().trim().min(1).max(4_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const debugEvaluationResultSchema = z
  .object({
    expression: z.string().max(4_000),
    result: z.string().max(65_536),
    type: z.string().max(500).optional(),
    variablesReference: dapReferenceSchema,
  })
  .strict();

export type DebugSession = z.infer<typeof debugSessionSchema>;
export type DebugBreakpoint = z.infer<typeof debugBreakpointSchema>;
export type DebugThread = z.infer<typeof debugThreadSchema>;
export type DebugStackFrame = z.infer<typeof debugStackFrameSchema>;
export type DebugScope = z.infer<typeof debugScopeSchema>;
export type DebugVariable = z.infer<typeof debugVariableSchema>;
export type DebugWatchExpression = z.infer<typeof debugWatchExpressionSchema>;
export type DebugEvaluationResult = z.infer<typeof debugEvaluationResultSchema>;
