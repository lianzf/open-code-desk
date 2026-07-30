import { z } from 'zod';
import { permissionRuleSchema } from './commands';

export const permissionChannels = {
  addBlockedPath: 'permissions:add-blocked-path',
  decideTool: 'permissions:decide-tool',
  deleteRule: 'permissions:delete-rule',
  grantExternalDirectory: 'permissions:grant-external-directory',
  listRules: 'permissions:list-rules',
  setReadAutoAllow: 'permissions:set-read-auto-allow',
} as const;

export const decideToolApprovalRequestSchema = z
  .object({
    callId: z.string().uuid(),
    expectedApprovalDigest: z.string().length(64),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();

export const permissionActionResponseSchema = z.object({ accepted: z.boolean() }).strict();

export const setReadAutoAllowRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    allowed: z.boolean(),
  })
  .strict();

export const addBlockedPathRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    relativePath: z.string().trim().min(1).max(2_048),
  })
  .strict();

export const grantExternalDirectoryRequestSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const nullablePermissionRuleSchema = permissionRuleSchema.nullable();

export type DecideToolApprovalRequest = z.infer<typeof decideToolApprovalRequestSchema>;
export type SetReadAutoAllowRequest = z.infer<typeof setReadAutoAllowRequestSchema>;
export type AddBlockedPathRequest = z.infer<typeof addBlockedPathRequestSchema>;
export type GrantExternalDirectoryRequest = z.infer<typeof grantExternalDirectoryRequestSchema>;
