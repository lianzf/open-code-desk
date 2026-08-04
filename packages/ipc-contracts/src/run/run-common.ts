import { z } from 'zod';

const environmentVariableNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^=\u0000]+$/, 'Environment variable names cannot contain equals signs or null bytes.');

export const projectTypeSchema = z.enum([
  'node',
  'typescript',
  'react',
  'vue',
  'nextjs',
  'electron',
  'java-maven',
  'java-gradle',
  'spring-boot',
  'python',
  'c',
  'cpp',
  'dotnet',
  'go',
  'rust',
  'script',
  'custom',
]);

export const runConsoleSchema = z.enum(['integratedTerminal', 'runOutput']);

const debugHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^[A-Za-z0-9._:%-]+$/u,
    'Debug hosts must be an IP address or DNS hostname without a scheme or path.',
  );

const remoteRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => /^(?:[A-Za-z]:[\\/]|\/|\\\\)/u.test(value) && !value.includes('\0'),
    'Remote roots must be absolute paths.',
  );

export const debugAttachConfigurationSchema = z
  .object({
    adapter: z.enum(['pwa-node', 'debugpy']),
    environment: z.enum(['remote', 'container']),
    host: debugHostSchema,
    port: z.number().int().min(1).max(65_535),
    remoteRoot: remoteRootSchema.optional(),
  })
  .strict();

export const runEnvironmentVariableInputSchema = z
  .object({
    name: environmentVariableNameSchema,
    value: z.string().max(65_536).optional(),
    sensitive: z.boolean().default(false),
  })
  .strict();

export const runEnvironmentVariableSchema = z
  .object({
    name: environmentVariableNameSchema,
    value: z.string().max(65_536).optional(),
    sensitive: z.boolean(),
    configured: z.boolean(),
  })
  .strict()
  .superRefine((variable, context) => {
    if (variable.sensitive && variable.value !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Sensitive environment variable values must not be exposed.',
        path: ['value'],
      });
    }
  });

export type ProjectType = z.infer<typeof projectTypeSchema>;
export type RunConsole = z.infer<typeof runConsoleSchema>;
export type DebugAttachConfiguration = z.infer<typeof debugAttachConfigurationSchema>;
export type RunEnvironmentVariableInput = z.infer<typeof runEnvironmentVariableInputSchema>;
export type RunEnvironmentVariable = z.infer<typeof runEnvironmentVariableSchema>;
