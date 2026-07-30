import { z } from 'zod';

const uuidSchema = z.string().uuid();
const optionalModelIdSchema = z.string().trim().min(1).max(255).optional();

export const providerKindSchema = z.enum([
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'deepseek',
  'qwen',
  'glm',
  'moonshot',
  'ollama',
]);

export const providerChannels = {
  delete: 'providers:delete',
  list: 'providers:list',
  listKinds: 'providers:list-kinds',
  listModels: 'providers:list-models',
  save: 'providers:save',
  testConnection: 'providers:test-connection',
} as const;

export const providerDescriptorSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    kind: providerKindSchema,
    available: z.boolean(),
  })
  .strict();

export const providerHeaderInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/),
    value: z.string().max(8_192).optional(),
    sensitive: z.boolean().default(false),
    configured: z.boolean().optional(),
  })
  .strict();

export const providerHeaderSchema = z
  .object({
    name: z.string().min(1).max(200),
    value: z.string().max(8_192).optional(),
    sensitive: z.boolean(),
    configured: z.boolean(),
  })
  .strict();

export const saveProviderRequestSchema = z
  .object({
    id: uuidSchema.optional(),
    kind: z.literal('openai-compatible'),
    displayName: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().min(1).max(2_048),
    apiKey: z.string().max(10_000).optional(),
    defaultModel: z.string().trim().min(1).max(255),
    fastModel: optionalModelIdSchema,
    reasoningModel: optionalModelIdSchema,
    contextWindow: z.number().int().min(1_024).max(10_000_000),
    toolCalling: z.boolean(),
    vision: z.boolean(),
    streaming: z.boolean(),
    customHeaders: z.array(providerHeaderInputSchema).max(20).default([]),
  })
  .strict();

export const providerConfigSchema = z
  .object({
    id: uuidSchema,
    kind: providerKindSchema,
    displayName: z.string().min(1).max(100),
    baseUrl: z.string().min(1).max(2_048),
    defaultModel: z.string().min(1).max(255),
    fastModel: optionalModelIdSchema,
    reasoningModel: optionalModelIdSchema,
    contextWindow: z.number().int().min(1_024).max(10_000_000),
    toolCalling: z.boolean(),
    vision: z.boolean(),
    streaming: z.boolean(),
    customHeaders: z.array(providerHeaderSchema).max(20),
    hasApiKey: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const providerConfigListSchema = z.array(providerConfigSchema).max(100);
export const providerDescriptorListSchema = z.array(providerDescriptorSchema).max(20);

export const deleteProviderRequestSchema = z.object({ providerId: uuidSchema }).strict();
export const providerIdRequestSchema = z.object({ providerId: uuidSchema }).strict();

export const modelInfoSchema = z
  .object({
    id: z.string().min(1).max(500),
    name: z.string().min(1).max(500),
    ownedBy: z.string().max(500).optional(),
  })
  .strict();

export const modelInfoListSchema = z.array(modelInfoSchema).max(10_000);

export const connectionTestResultSchema = z
  .object({
    valid: z.boolean(),
    message: z.string().min(1).max(2_000),
  })
  .strict();

export const deleteProviderResponseSchema = z.object({ deleted: z.literal(true) }).strict();

export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
export type ProviderHeaderInput = z.infer<typeof providerHeaderInputSchema>;
export type ProviderHeader = z.infer<typeof providerHeaderSchema>;
export type SaveProviderRequest = z.infer<typeof saveProviderRequestSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type DeleteProviderRequest = z.infer<typeof deleteProviderRequestSchema>;
export type ProviderIdRequest = z.infer<typeof providerIdRequestSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;
