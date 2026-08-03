import { z } from 'zod';

export const commandChannels = {
  cancel: 'commands:cancel',
  decide: 'commands:decide',
  deleteRule: 'commands:delete-rule',
  listForConversation: 'commands:list-for-conversation',
  listRules: 'commands:list-rules',
  setNetworkAccess: 'commands:set-network-access',
  upsertExecutableRule: 'commands:upsert-executable-rule',
} as const;

export const commandExecutionStatusSchema = z.enum([
  'pending_approval',
  'approved',
  'running',
  'completed',
  'failed',
  'rejected',
  'cancelled',
  'timed_out',
]);

const commandErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
    causeId: z.string().max(100).optional(),
  })
  .strict();

export const commandExecutionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid(),
    taskId: z.string().uuid(),
    modelToolCallId: z.string().min(1).max(500),
    toolName: z.enum(['run_command', 'run_tests']),
    executable: z.string().min(1).max(1_000),
    args: z.array(z.string().max(8_000)).max(128),
    cwd: z.string().min(1).max(4_000),
    timeoutMs: z.number().int().min(1_000).max(600_000),
    riskLevel: z.enum(['low', 'medium', 'high', 'blocked']),
    riskReasons: z.array(z.string().max(1_000)).max(20),
    approvalDigest: z.string().length(64),
    status: commandExecutionStatusSchema,
    autoApproved: z.boolean(),
    outputTail: z.string().max(100_000),
    outputBytes: z.number().int().nonnegative(),
    exitCode: z.number().int().optional(),
    terminationSignal: z.string().max(100).optional(),
    error: commandErrorSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    approvedAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const commandExecutionListSchema = z.array(commandExecutionSchema).max(1_000);

export const listCommandsRequestSchema = z.object({ conversationId: z.string().uuid() }).strict();

export const decideCommandRequestSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedApprovalDigest: z.string().length(64),
    decision: z.enum(['approve', 'reject']),
    rememberExecutable: z.boolean().default(false),
  })
  .strict();

export const commandIdRequestSchema = z.object({ commandId: z.string().uuid() }).strict();
export const commandActionResponseSchema = z.object({ accepted: z.boolean() }).strict();

export const permissionRuleSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind: z.enum([
      'allow_executable',
      'deny_executable',
      'allow_network_commands',
      'require_read_approval',
      'blocked_path',
      'external_directory',
    ]),
    value: z.string().max(8_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const permissionRuleListSchema = z.array(permissionRuleSchema).max(1_000);
export const workspaceRulesRequestSchema = z.object({ workspaceId: z.string().uuid() }).strict();
export const deletePermissionRuleRequestSchema = z
  .object({ workspaceId: z.string().uuid(), ruleId: z.string().uuid() })
  .strict();
export const deletePermissionRuleResponseSchema = z.object({ deleted: z.boolean() }).strict();
export const setNetworkAccessRequestSchema = z
  .object({ workspaceId: z.string().uuid(), allowed: z.boolean() })
  .strict();
export const upsertExecutableRuleRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    kind: z.enum(['allow_executable', 'deny_executable']),
    executable: z.string().trim().min(1).max(1_000),
    cwd: z.string().trim().max(2_000).default(''),
    args: z.array(z.string().max(8_000)).max(128).default([]),
  })
  .strict();

export type CommandExecution = z.infer<typeof commandExecutionSchema>;
export type ListCommandsRequest = z.infer<typeof listCommandsRequestSchema>;
export type DecideCommandRequest = z.infer<typeof decideCommandRequestSchema>;
export type CommandIdRequest = z.infer<typeof commandIdRequestSchema>;
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
export type WorkspaceRulesRequest = z.infer<typeof workspaceRulesRequestSchema>;
export type DeletePermissionRuleRequest = z.infer<typeof deletePermissionRuleRequestSchema>;
export type SetNetworkAccessRequest = z.infer<typeof setNetworkAccessRequestSchema>;
export type UpsertExecutableRuleRequest = z.infer<typeof upsertExecutableRuleRequestSchema>;
