import { z } from 'zod';

const providerIdSchema = z.string().uuid();
const modelIdSchema = z.string().trim().min(1).max(500);

export const settingsChannels = {
  get: 'settings:get',
  update: 'settings:update',
} as const;

export const appSettingsSchema = z
  .object({
    selectedProviderId: providerIdSchema.optional(),
    selectedModels: z.record(providerIdSchema, modelIdSchema).default({}),
  })
  .strict();

export const updateAppSettingsRequestSchema = appSettingsSchema;

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateAppSettingsRequest = z.infer<typeof updateAppSettingsRequestSchema>;
