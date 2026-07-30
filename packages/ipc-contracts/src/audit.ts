import { z } from 'zod';

export const auditChannels = {
  list: 'audit:list',
} as const;

export const auditEventSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    actor: z.enum(['user', 'agent', 'system']),
    category: z.enum(['tool', 'command', 'file_change', 'file_system', 'permission', 'security']),
    action: z.string().min(1).max(200),
    outcome: z.enum([
      'requested',
      'allowed',
      'denied',
      'started',
      'succeeded',
      'failed',
      'cancelled',
    ]),
    summary: z.string().max(1_000),
    metadata: z.record(
      z.string().max(100),
      z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]),
    ),
    createdAt: z.string().datetime(),
  })
  .strict();

export const auditEventListSchema = z.array(auditEventSchema).max(500);

export const listAuditEventsRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type ListAuditEventsRequest = z.infer<typeof listAuditEventsRequestSchema>;
