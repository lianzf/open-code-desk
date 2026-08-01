import { z } from 'zod';

export const contextChannels = {
  delete: 'context:delete',
  list: 'context:list',
  pickImage: 'context:pick-image',
  save: 'context:save',
} as const;

export const contextItemTypeSchema = z.enum([
  'file',
  'selection',
  'directory',
  'git_diff',
  'terminal',
  'diagnostic',
  'image',
  'text',
  'summary',
]);

const saveableContextItemTypeSchema = z.enum([
  'file',
  'selection',
  'directory',
  'git_diff',
  'terminal',
  'diagnostic',
  'text',
  'summary',
]);

export const conversationContextItemSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    type: saveableContextItemTypeSchema,
    title: z.string().min(1).max(300),
    content: z.string().max(500_000),
    tokenEstimate: z.number().int().positive(),
    priority: z.number().int().min(0).max(1_000),
    sourceKey: z.string().min(1).max(4_096).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const contextConversationRequestSchema = z
  .object({ conversationId: z.string().uuid() })
  .strict();

export const saveConversationContextRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    type: contextItemTypeSchema,
    title: z.string().trim().min(1).max(300),
    content: z.string().min(1).max(500_000),
    priority: z.number().int().min(0).max(1_000).default(50),
    sourceKey: z.string().trim().min(1).max(4_096).optional(),
  })
  .strict();

export const deleteConversationContextRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    contextItemId: z.string().uuid(),
  })
  .strict();

export const conversationContextListSchema = z.array(conversationContextItemSchema).max(1_000);
export const pickConversationImageResponseSchema = conversationContextItemSchema.nullable();
export const deleteConversationContextResponseSchema = z.object({ deleted: z.boolean() }).strict();

export type ConversationContextItem = z.infer<typeof conversationContextItemSchema>;
export type ContextConversationRequest = z.infer<typeof contextConversationRequestSchema>;
export type SaveConversationContextRequest = z.infer<typeof saveConversationContextRequestSchema>;
export type DeleteConversationContextRequest = z.infer<
  typeof deleteConversationContextRequestSchema
>;
