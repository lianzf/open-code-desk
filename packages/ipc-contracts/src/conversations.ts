import { z } from 'zod';

export const conversationsChannels = {
  create: 'conversations:create',
  delete: 'conversations:delete',
  exportMarkdown: 'conversations:export-markdown',
  get: 'conversations:get',
  list: 'conversations:list',
  rename: 'conversations:rename',
} as const;

export const conversationSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string().min(1).max(200),
    providerConfigId: z.string().uuid().optional(),
    modelId: z.string().max(255).optional(),
    status: z.enum(['active', 'archived']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const messageToolCallSchema = z
  .object({
    id: z.string().max(500),
    name: z.string().max(500),
    arguments: z.string().max(200_000),
  })
  .strict();

export const conversationMessageSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().max(200_000),
    reasoning: z.string().max(200_000),
    toolCallId: z.string().max(500).optional(),
    toolCalls: z.array(messageToolCallSchema).max(100),
    sequence: z.number().int().positive(),
    modelId: z.string().max(255).optional(),
    status: z.enum(['streaming', 'complete', 'error', 'cancelled']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const agentTaskSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    requestId: z.string().uuid(),
    status: z.enum([
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
    ]),
    attempt: z.number().int().positive(),
    checkpoint: z
      .object({
        round: z.number().int().nonnegative(),
        steps: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                label: z.string().min(1).max(500),
                status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
                startedAt: z.string().datetime().optional(),
                completedAt: z.string().datetime().optional(),
              })
              .strict(),
          )
          .max(50),
        updatedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
        causeId: z.string().optional(),
      })
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const toolCallRecordSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    conversationId: z.string().uuid(),
    toolName: z.string().min(1).max(500),
    permissionLevel: z.enum(['read', 'write', 'execute', 'dangerous']),
    input: z.unknown(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'rejected']),
    approvalDigest: z.string().length(64).optional(),
    output: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
      })
      .optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const listConversationsRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    query: z.string().max(200).default(''),
  })
  .strict();
export const conversationListSchema = z.array(conversationSchema).max(100);

export const createConversationRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    providerConfigId: z.string().uuid().optional(),
    modelId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export const conversationIdRequestSchema = z.object({ conversationId: z.string().uuid() }).strict();

export const renameConversationRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const conversationDetailSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(conversationMessageSchema).max(10_000),
    latestTask: agentTaskSchema.nullable(),
    toolCalls: z.array(toolCallRecordSchema).max(10_000),
  })
  .strict();

export const deleteConversationResponseSchema = z.object({ deleted: z.literal(true) }).strict();
export const exportConversationResponseSchema = z
  .object({
    saved: z.boolean(),
    path: z.string().optional(),
  })
  .strict();

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ListConversationsRequest = z.infer<typeof listConversationsRequestSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type ConversationIdRequest = z.infer<typeof conversationIdRequestSchema>;
export type RenameConversationRequest = z.infer<typeof renameConversationRequestSchema>;
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
export type AgentTaskCheckpoint = NonNullable<z.infer<typeof agentTaskSchema>['checkpoint']>;
