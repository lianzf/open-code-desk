import { z } from 'zod';

export const crashReportChannels = {
  list: 'crash-reports:list',
  acknowledge: 'crash-reports:acknowledge',
} as const;

export const crashProcessTypeSchema = z.enum(['main', 'renderer', 'child']);
export const crashReportSchema = z
  .object({
    id: z.string().uuid(),
    processType: crashProcessTypeSchema,
    reason: z.string().min(1).max(200),
    exitCode: z.number().int().optional(),
    appVersion: z.string().min(1).max(100),
    details: z.record(
      z.string().max(100),
      z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]),
    ),
    createdAt: z.string().datetime(),
    acknowledgedAt: z.string().datetime().optional(),
  })
  .strict();

export const crashReportListSchema = z.array(crashReportSchema);
export const listCrashReportsRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export const acknowledgeCrashReportRequestSchema = z
  .object({
    reportId: z.string().uuid(),
  })
  .strict();
export const acknowledgeCrashReportResponseSchema = z
  .object({
    acknowledged: z.boolean(),
  })
  .strict();

export type CrashProcessType = z.infer<typeof crashProcessTypeSchema>;
export type CrashReport = z.infer<typeof crashReportSchema>;
export type ListCrashReportsRequest = z.infer<typeof listCrashReportsRequestSchema>;
export type AcknowledgeCrashReportRequest = z.infer<typeof acknowledgeCrashReportRequestSchema>;
