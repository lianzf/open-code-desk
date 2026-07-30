import { z } from 'zod';

import { conversationMessageSchema } from './conversations';
import { commandExecutionSchema } from './commands';

const requestIdSchema = z.string().uuid();

export const agentStatusSchema = z.enum([
  'idle',
  'analyzing',
  'planning',
  'waiting_for_approval',
  'executing_tool',
  'editing_files',
  'running_tests',
  'completed',
  'failed',
  'cancelled',
]);

export const appErrorSchema = z
  .object({
    code: z.enum([
      'PROVIDER_AUTH_FAILED',
      'PROVIDER_RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'MODEL_NOT_FOUND',
      'CONTEXT_TOO_LARGE',
      'FILE_ACCESS_DENIED',
      'WORKSPACE_BOUNDARY_VIOLATION',
      'COMMAND_REJECTED',
      'COMMAND_FAILED',
      'PATCH_CONFLICT',
      'DATABASE_ERROR',
      'VALIDATION_ERROR',
      'CANCELLED',
      'UNKNOWN_ERROR',
    ]),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
    causeId: z.string().max(100).optional(),
  })
  .strict();

export const chatChannels = {
  cancel: 'chat:cancel',
  start: 'chat:start',
  streamEvent: 'chat:stream-event',
} as const;

export const startChatRequestSchema = z
  .object({
    requestId: requestIdSchema,
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    providerId: z.string().uuid(),
    model: z.string().trim().min(1).max(255).optional(),
    content: z.string().trim().min(1).max(200_000),
  })
  .strict();

export const startChatResponseSchema = z.object({ requestId: requestIdSchema }).strict();

export const cancelChatRequestSchema = z.object({ requestId: requestIdSchema }).strict();
export const cancelChatResponseSchema = z.object({ cancelled: z.boolean() }).strict();

const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();

const toolErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

export const chatStreamPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('agent_status'),
      taskId: z.string().uuid(),
      status: agentStatusSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('context_built'),
      budget: z.number().int().positive(),
      usedTokens: z.number().int().nonnegative(),
      droppedMessages: z.number().int().nonnegative(),
      summarizedMessages: z.number().int().nonnegative(),
      selectedContextItems: z.number().int().nonnegative(),
      droppedContextItems: z.number().int().nonnegative(),
      truncatedContextItems: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('assistant_message_start'),
      message: conversationMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('text_delta'),
      messageId: z.string().uuid(),
      delta: z.string().max(200_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('reasoning_delta'),
      messageId: z.string().uuid(),
      delta: z.string().max(200_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('usage'),
      messageId: z.string().uuid(),
      usage: providerUsageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('assistant_message_end'),
      message: conversationMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_status'),
      callId: z.string().uuid(),
      modelCallId: z.string().max(500),
      name: z.string().min(1).max(500),
      status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'rejected']),
      input: z.unknown().optional(),
      outputPreview: z.string().max(2_000).optional(),
      error: toolErrorSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('change_set_ready'),
      taskId: z.string().uuid(),
      conversationId: z.string().uuid(),
      changeSetId: z.string().uuid(),
      changeCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('command_proposed'),
      command: commandExecutionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('command_status'),
      command: commandExecutionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('command_output'),
      commandId: z.string().uuid(),
      taskId: z.string().uuid(),
      stream: z.enum(['stdout', 'stderr']),
      chunk: z.string().max(64_000),
    })
    .strict(),
  z.object({ type: z.literal('completed'), taskId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('cancelled'), taskId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('error'),
      taskId: z.string().uuid().optional(),
      error: appErrorSchema,
    })
    .strict(),
]);

export const chatStreamEventSchema = z
  .object({
    requestId: requestIdSchema,
    event: chatStreamPayloadSchema,
  })
  .strict();

export type StartChatRequest = z.infer<typeof startChatRequestSchema>;
export type StartChatResponse = z.infer<typeof startChatResponseSchema>;
export type CancelChatRequest = z.infer<typeof cancelChatRequestSchema>;
export type ChatStreamPayload = z.infer<typeof chatStreamPayloadSchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
