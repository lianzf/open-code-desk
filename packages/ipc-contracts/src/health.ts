import { z } from 'zod';

export const ipcChannels = {
  healthCheck: 'app:health-check',
} as const;

export const healthRequestSchema = z
  .object({
    requestId: z.string().uuid(),
  })
  .strict();

export const healthResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.literal('ok'),
    version: z.string().min(1),
    timestamp: z.string().datetime(),
  })
  .strict();

export type HealthRequest = z.infer<typeof healthRequestSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
