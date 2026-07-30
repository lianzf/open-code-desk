import { z } from 'zod';

const terminalSessionIdSchema = z.string().uuid();

export const terminalChannels = {
  close: 'terminal:close',
  create: 'terminal:create',
  data: 'terminal:data',
  exit: 'terminal:exit',
  resize: 'terminal:resize',
  write: 'terminal:write',
} as const;

export const createTerminalRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(200).default(24),
  })
  .strict();

export const terminalSessionInfoSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    shell: z.string().min(1).max(32_768),
    cwd: z.string().min(1).max(32_768),
  })
  .strict();

export const terminalWriteRequestSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    data: z.string().max(65_536),
  })
  .strict();

export const terminalResizeRequestSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

export const terminalSessionRequestSchema = z
  .object({ sessionId: terminalSessionIdSchema })
  .strict();

export const terminalActionResponseSchema = z.object({ accepted: z.boolean() }).strict();

export const terminalDataEventSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    data: z.string().max(65_536),
  })
  .strict();

export const terminalExitEventSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    exitCode: z.number().int(),
    signal: z.number().int().optional(),
  })
  .strict();

export type CreateTerminalRequest = z.infer<typeof createTerminalRequestSchema>;
export type TerminalSessionInfo = z.infer<typeof terminalSessionInfoSchema>;
export type TerminalWriteRequest = z.infer<typeof terminalWriteRequestSchema>;
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;
export type TerminalSessionRequest = z.infer<typeof terminalSessionRequestSchema>;
export type TerminalDataEvent = z.infer<typeof terminalDataEventSchema>;
export type TerminalExitEvent = z.infer<typeof terminalExitEventSchema>;
