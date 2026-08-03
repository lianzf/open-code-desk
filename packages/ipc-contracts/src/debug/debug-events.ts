import { z } from 'zod';

import { sessionIdSchema, workspaceIdSchema } from './debug-internal';
import {
  debugBreakpointSchema,
  debugScopeSchema,
  debugSessionSchema,
  debugSessionStatusSchema,
  debugStackFrameSchema,
  debugThreadSchema,
  debugVariableSchema,
  debugWatchExpressionSchema,
} from './debug-models';

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

export type DebugEvent = z.infer<typeof debugEventSchema>;
