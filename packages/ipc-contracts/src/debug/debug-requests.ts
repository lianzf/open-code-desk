import { z } from 'zod';

import {
  dapReferenceSchema,
  relativePathSchema,
  sessionIdSchema,
  uuidSchema,
  workspaceIdSchema,
} from './debug-internal';

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
    kind: z.enum(['line', 'function', 'data']).optional(),
    relativePath: relativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    enabled: z.boolean().default(true),
    condition: z.string().trim().min(1).max(4_000).optional(),
    hitCondition: z.string().trim().min(1).max(1_000).optional(),
    logMessage: z.string().trim().min(1).max(4_000).optional(),
    functionName: z.string().trim().min(1).max(1_000).optional(),
    dataId: z.string().trim().min(1).max(4_000).optional(),
    dataAccessType: z.enum(['read', 'write', 'readWrite']).optional(),
  })
  .strict()
  .superRefine((breakpoint, context) => {
    const kind = breakpoint.kind ?? 'line';
    if (
      kind === 'line' &&
      (breakpoint.relativePath === undefined || breakpoint.line === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Line breakpoints require a path and line.',
        path: ['relativePath'],
      });
    }
    if (kind === 'function' && breakpoint.functionName === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Function breakpoints require a function name.',
        path: ['functionName'],
      });
    }
    if (kind === 'data' && breakpoint.dataId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Data breakpoints require a debugger data ID.',
        path: ['dataId'],
      });
    }
  });

export const deleteDebugBreakpointRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, breakpointId: uuidSchema })
  .strict();
export const debugMutationResponseSchema = z.object({ accepted: z.boolean() }).strict();

export const debugExceptionPauseModeSchema = z.enum(['none', 'uncaught', 'all']);
const debugExceptionTypesSchema = z.array(z.string().trim().min(1).max(200)).max(100).default([]);
export const debugSettingsSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    exceptionPauseMode: debugExceptionPauseModeSchema,
    exceptionBreakTypes: debugExceptionTypesSchema,
    exceptionIgnoreTypes: debugExceptionTypesSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();
export const getDebugSettingsRequestSchema = z.object({ workspaceId: workspaceIdSchema }).strict();
export const saveDebugSettingsRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    exceptionPauseMode: debugExceptionPauseModeSchema,
    exceptionBreakTypes: debugExceptionTypesSchema,
    exceptionIgnoreTypes: debugExceptionTypesSchema,
  })
  .strict();

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

export type DebugSettings = z.infer<typeof debugSettingsSchema>;
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
export type GetDebugSettingsRequest = z.infer<typeof getDebugSettingsRequestSchema>;
export type SaveDebugSettingsRequest = z.infer<typeof saveDebugSettingsRequestSchema>;
export type ListDebugWatchesRequest = z.infer<typeof listDebugWatchesRequestSchema>;
export type SaveDebugWatchRequest = z.infer<typeof saveDebugWatchRequestSchema>;
export type DeleteDebugWatchRequest = z.infer<typeof deleteDebugWatchRequestSchema>;
export type EvaluateDebugRequest = z.infer<typeof evaluateDebugRequestSchema>;
export type RunToCursorRequest = z.infer<typeof runToCursorRequestSchema>;
