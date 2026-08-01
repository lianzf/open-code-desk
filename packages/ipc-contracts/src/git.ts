import { z } from 'zod';

export const gitChannels = {
  diff: 'git:diff',
  status: 'git:status',
} as const;

export const gitStatusRequestSchema = z.object({ workspaceId: z.string().uuid() }).strict();

export const gitFileStatusSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    indexStatus: z.string().max(4),
    workingTreeStatus: z.string().max(4),
    staged: z.boolean(),
    modified: z.boolean(),
    untracked: z.boolean(),
    conflicted: z.boolean(),
  })
  .strict();

export const gitStatusSchema = z
  .object({
    workspaceId: z.string().uuid(),
    isRepository: z.boolean(),
    branch: z.string().max(1_000).optional(),
    tracking: z.string().max(1_000).optional(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    detached: z.boolean(),
    clean: z.boolean(),
    files: z.array(gitFileStatusSchema).max(20_000),
  })
  .strict();

export const gitDiffRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    staged: z.boolean().default(false),
    path: z.string().trim().min(1).max(4_096).optional(),
    maxCharacters: z.number().int().min(1_000).max(500_000).default(200_000),
  })
  .strict();

export const gitDiffSchema = z
  .object({
    workspaceId: z.string().uuid(),
    staged: z.boolean(),
    path: z.string().max(4_096).optional(),
    content: z.string().max(500_100),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export type GitStatusRequest = z.infer<typeof gitStatusRequestSchema>;
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiffRequest = z.infer<typeof gitDiffRequestSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
