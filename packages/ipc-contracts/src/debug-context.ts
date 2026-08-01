import { z } from 'zod';

import { conversationContextItemSchema } from './context';

const uuidSchema = z.string().uuid();
const conversationIdSchema = uuidSchema;
const workspaceIdSchema = uuidSchema;

export const debugContextChannels = {
  preview: 'debug-context:preview',
  attach: 'debug-context:attach',
} as const;

export const debugContextSectionKeySchema = z.enum([
  'location',
  'source',
  'exception',
  'stack',
  'variables',
  'watches',
  'console',
  'configuration',
  'git_diff',
  'recent_changes',
  'dependencies',
]);

export const debugContextSectionSchema = z
  .object({
    key: debugContextSectionKeySchema,
    title: z.string().trim().min(1).max(100),
    content: z.string().max(32_768),
    tokenEstimate: z.number().int().nonnegative(),
    redactionCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    selectedByDefault: z.boolean(),
  })
  .strict();

export const debugContextSnapshotSchema = z
  .object({
    id: uuidSchema,
    sessionId: uuidSchema,
    workspaceId: workspaceIdSchema,
    conversationId: conversationIdSchema,
    pauseFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
    digest: z.string().regex(/^[a-f0-9]{64}$/i),
    sections: z.array(debugContextSectionSchema).min(1).max(11),
    totalTokenEstimate: z.number().int().nonnegative(),
    totalRedactionCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const previewDebugContextRequestSchema = z
  .object({ sessionId: uuidSchema, conversationId: conversationIdSchema })
  .strict();

export const attachDebugContextRequestSchema = z
  .object({
    snapshotId: uuidSchema,
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    conversationId: conversationIdSchema,
    selectedSections: z.array(debugContextSectionKeySchema).min(1).max(11),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.selectedSections).size !== value.selectedSections.length) {
      context.addIssue({ code: 'custom', message: 'Debug context sections must be unique.' });
    }
  });

export const attachDebugContextResponseSchema = z
  .object({
    snapshotId: uuidSchema,
    contextItem: conversationContextItemSchema,
    prompt: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type DebugContextSectionKey = z.infer<typeof debugContextSectionKeySchema>;
export type DebugContextSection = z.infer<typeof debugContextSectionSchema>;
export type DebugContextSnapshot = z.infer<typeof debugContextSnapshotSchema>;
export type PreviewDebugContextRequest = z.infer<typeof previewDebugContextRequestSchema>;
export type AttachDebugContextRequest = z.infer<typeof attachDebugContextRequestSchema>;
export type AttachDebugContextResponse = z.infer<typeof attachDebugContextResponseSchema>;
