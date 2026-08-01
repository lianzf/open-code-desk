import { z } from 'zod';

import { runCommandSnapshotSchema, runRiskLevelSchema } from './run';

const uuidSchema = z.string().uuid();
const workspaceIdSchema = uuidSchema;
const sessionIdSchema = uuidSchema;
const relativePathSchema = z.string().min(1).max(2_048);
const dapReferenceSchema = z.number().int().nonnegative();

export const debugChannels = {
  continue: 'debug:continue',
  decideStart: 'debug:decide-start',
  deleteBreakpoint: 'debug:delete-breakpoint',
  deleteWatch: 'debug:delete-watch',
  evaluate: 'debug:evaluate',
  event: 'debug:event',
  listBreakpoints: 'debug:list-breakpoints',
  listHistory: 'debug:list-history',
  listWatches: 'debug:list-watches',
  next: 'debug:next',
  pause: 'debug:pause',
  proposeStart: 'debug:propose-start',
  restart: 'debug:restart',
  runToCursor: 'debug:run-to-cursor',
  saveBreakpoint: 'debug:save-breakpoint',
  saveWatch: 'debug:save-watch',
  scopes: 'debug:scopes',
  stackTrace: 'debug:stack-trace',
  stepIn: 'debug:step-in',
  stepOut: 'debug:step-out',
  stop: 'debug:stop',
  threads: 'debug:threads',
  variables: 'debug:variables',
} as const;

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
    functionBreakpoints: z.boolean(),
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

export const proposeDebugStartRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, configurationId: uuidSchema })
  .strict();

export const decideDebugStartRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    expectedApprovalDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();

export const debugSessionRequestSchema = z.object({ sessionId: sessionIdSchema }).strict();
export const debugThreadRequestSchema = z
  .object({ sessionId: sessionIdSchema, threadId: dapReferenceSchema })
  .strict();
export const debugFrameRequestSchema = z
  .object({ sessionId: sessionIdSchema, frameId: z.number().int().nonnegative() })
  .strict();
export const debugVariablesRequestSchema = z
  .object({ sessionId: sessionIdSchema, variablesReference: dapReferenceSchema })
  .strict();

export const listDebugHistoryRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    limit: z.number().int().min(1).max(1_000).default(100),
  })
  .strict();
export const listDebugBreakpointsRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, relativePath: relativePathSchema.optional() })
  .strict();
export const saveDebugBreakpointRequestSchema = z
  .object({
    id: uuidSchema.optional(),
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema,
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export const deleteDebugBreakpointRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, breakpointId: uuidSchema })
  .strict();
export const debugMutationResponseSchema = z.object({ accepted: z.boolean() }).strict();

export const listDebugWatchesRequestSchema = z.object({ workspaceId: workspaceIdSchema }).strict();
export const saveDebugWatchRequestSchema = z
  .object({
    id: uuidSchema.optional(),
    workspaceId: workspaceIdSchema,
    expression: z.string().trim().min(1).max(4_000),
  })
  .strict();
export const deleteDebugWatchRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, watchId: uuidSchema })
  .strict();

export const evaluateDebugRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    expression: z.string().trim().min(1).max(4_000),
    frameId: z.number().int().nonnegative().optional(),
    context: z.enum(['watch', 'repl', 'hover']).default('repl'),
  })
  .strict();

export const runToCursorRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    relativePath: relativePathSchema,
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
  })
  .strict();

export const debugStatusEventSchema = z
  .object({
    type: z.literal('status'),
    session: debugSessionSchema,
    previousStatus: debugSessionStatusSchema.optional(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const debugOutputEventSchema = z
  .object({
    type: z.literal('output'),
    sessionId: sessionIdSchema,
    workspaceId: workspaceIdSchema,
    category: z.enum(['console', 'stdout', 'stderr', 'telemetry', 'important']),
    sequence: z.number().int().nonnegative(),
    data: z.string().max(65_536),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const debugBreakpointsEventSchema = z
  .object({
    type: z.literal('breakpoints'),
    workspaceId: workspaceIdSchema,
    breakpoints: z.array(debugBreakpointSchema).max(10_000),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const debugEventSchema = z.discriminatedUnion('type', [
  debugStatusEventSchema,
  debugOutputEventSchema,
  debugBreakpointsEventSchema,
]);

export const debugSessionListSchema = z.array(debugSessionSchema).max(1_000);
export const debugBreakpointListSchema = z.array(debugBreakpointSchema).max(10_000);
export const debugThreadListSchema = z.array(debugThreadSchema).max(1_000);
export const debugStackFrameListSchema = z.array(debugStackFrameSchema).max(10_000);
export const debugScopeListSchema = z.array(debugScopeSchema).max(1_000);
export const debugVariableListSchema = z.array(debugVariableSchema).max(20_000);
export const debugWatchExpressionListSchema = z.array(debugWatchExpressionSchema).max(1_000);

export type DebugSession = z.infer<typeof debugSessionSchema>;
export type DebugEvent = z.infer<typeof debugEventSchema>;
export type DebugBreakpoint = z.infer<typeof debugBreakpointSchema>;
export type DebugThread = z.infer<typeof debugThreadSchema>;
export type DebugStackFrame = z.infer<typeof debugStackFrameSchema>;
export type DebugScope = z.infer<typeof debugScopeSchema>;
export type DebugVariable = z.infer<typeof debugVariableSchema>;
export type DebugWatchExpression = z.infer<typeof debugWatchExpressionSchema>;
export type DebugEvaluationResult = z.infer<typeof debugEvaluationResultSchema>;
export type ProposeDebugStartRequest = z.infer<typeof proposeDebugStartRequestSchema>;
export type DecideDebugStartRequest = z.infer<typeof decideDebugStartRequestSchema>;
export type DebugSessionRequest = z.infer<typeof debugSessionRequestSchema>;
export type DebugThreadRequest = z.infer<typeof debugThreadRequestSchema>;
export type DebugFrameRequest = z.infer<typeof debugFrameRequestSchema>;
export type DebugVariablesRequest = z.infer<typeof debugVariablesRequestSchema>;
export type ListDebugHistoryRequest = z.infer<typeof listDebugHistoryRequestSchema>;
export type ListDebugBreakpointsRequest = z.infer<typeof listDebugBreakpointsRequestSchema>;
export type SaveDebugBreakpointRequest = z.infer<typeof saveDebugBreakpointRequestSchema>;
export type DeleteDebugBreakpointRequest = z.infer<typeof deleteDebugBreakpointRequestSchema>;
export type ListDebugWatchesRequest = z.infer<typeof listDebugWatchesRequestSchema>;
export type SaveDebugWatchRequest = z.infer<typeof saveDebugWatchRequestSchema>;
export type DeleteDebugWatchRequest = z.infer<typeof deleteDebugWatchRequestSchema>;
export type EvaluateDebugRequest = z.infer<typeof evaluateDebugRequestSchema>;
export type RunToCursorRequest = z.infer<typeof runToCursorRequestSchema>;
