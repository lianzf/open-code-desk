import { z } from 'zod';

export const updateChannels = {
  getStatus: 'updates:get-status',
  check: 'updates:check',
  download: 'updates:download',
  install: 'updates:install',
  statusChanged: 'updates:status-changed',
} as const;

export const updatePhaseSchema = z.enum([
  'idle',
  'checking',
  'available',
  'not_available',
  'downloading',
  'downloaded',
  'error',
  'unsupported',
]);

export const updateStatusSchema = z
  .object({
    phase: updatePhaseSchema,
    currentVersion: z.string().min(1).max(100),
    availableVersion: z.string().min(1).max(100).optional(),
    progress: z.number().min(0).max(100).optional(),
    message: z.string().min(1).max(1_000).optional(),
    checkedAt: z.string().datetime().optional(),
  })
  .strict();

export const updateActionRequestSchema = z.object({}).strict();
export const installUpdateResponseSchema = z.object({ accepted: z.literal(true) }).strict();

export type UpdateStatus = z.infer<typeof updateStatusSchema>;
