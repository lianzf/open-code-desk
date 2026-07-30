import { z } from 'zod';

export const changesChannels = {
  apply: 'changes:apply',
  editProposal: 'changes:edit-proposal',
  get: 'changes:get',
  getContents: 'changes:get-contents',
  listForConversation: 'changes:list-for-conversation',
  review: 'changes:review',
  reviewMany: 'changes:review-many',
  rollback: 'changes:rollback',
} as const;

export const fileChangeStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'applied',
  'failed',
  'rolled_back',
]);

export const fileChangeSetStatusSchema = z.enum([
  'pending_review',
  'ready_to_apply',
  'applying',
  'applied',
  'failed',
  'rolling_back',
  'rolled_back',
  'cancelled',
]);

export const fileChangeSchema = z
  .object({
    id: z.string().uuid(),
    changeSetId: z.string().uuid(),
    sequence: z.number().int().positive(),
    filePath: z.string().min(1).max(2_000),
    destinationPath: z.string().min(1).max(2_000).optional(),
    operation: z.enum(['create', 'update', 'delete', 'rename']),
    baselineHash: z.string().length(64).optional(),
    proposedHash: z.string().length(64).optional(),
    appliedHash: z.string().length(64).optional(),
    diff: z.string().max(4_100_000),
    reviewDigest: z.string().length(64),
    status: fileChangeStatusSchema,
    error: z.string().max(4_000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    appliedAt: z.string().datetime().optional(),
    rolledBackAt: z.string().datetime().optional(),
  })
  .strict();

export const fileChangeSetSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    taskId: z.string().uuid(),
    title: z.string().min(1).max(200),
    status: fileChangeSetStatusSchema,
    applyDigest: z.string().length(64).optional(),
    error: z.string().max(4_000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    appliedAt: z.string().datetime().optional(),
    rolledBackAt: z.string().datetime().optional(),
    changes: z.array(fileChangeSchema).max(500),
  })
  .strict();

export const fileChangeSetListSchema = z.array(fileChangeSetSchema).max(100);

export const listChangeSetsRequestSchema = z.object({ conversationId: z.string().uuid() }).strict();

export const changeSetIdRequestSchema = z.object({ changeSetId: z.string().uuid() }).strict();

export const changeContentsRequestSchema = z.object({ changeId: z.string().uuid() }).strict();
export const changeContentsSchema = z
  .object({
    originalContent: z.string().max(2_000_000),
    proposedContent: z.string().max(2_000_000),
  })
  .strict();

export const reviewChangeRequestSchema = z
  .object({
    changeId: z.string().uuid(),
    expectedReviewDigest: z.string().length(64),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();

export const reviewManyChangesRequestSchema = z
  .object({
    changeSetId: z.string().uuid(),
    entries: z
      .array(
        z
          .object({
            changeId: z.string().uuid(),
            reviewDigest: z.string().length(64),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();

export const editChangeProposalRequestSchema = z
  .object({
    changeId: z.string().uuid(),
    expectedReviewDigest: z.string().length(64),
    content: z.string().max(2_000_000),
  })
  .strict();

export const applyChangeSetRequestSchema = z
  .object({
    changeSetId: z.string().uuid(),
    expectedApplyDigest: z.string().length(64),
  })
  .strict();

export type FileChange = z.infer<typeof fileChangeSchema>;
export type FileChangeSet = z.infer<typeof fileChangeSetSchema>;
export type ListChangeSetsRequest = z.infer<typeof listChangeSetsRequestSchema>;
export type ChangeSetIdRequest = z.infer<typeof changeSetIdRequestSchema>;
export type ChangeContentsRequest = z.infer<typeof changeContentsRequestSchema>;
export type ChangeContents = z.infer<typeof changeContentsSchema>;
export type ReviewChangeRequest = z.infer<typeof reviewChangeRequestSchema>;
export type ReviewManyChangesRequest = z.infer<typeof reviewManyChangesRequestSchema>;
export type EditChangeProposalRequest = z.infer<typeof editChangeProposalRequestSchema>;
export type ApplyChangeSetRequest = z.infer<typeof applyChangeSetRequestSchema>;
