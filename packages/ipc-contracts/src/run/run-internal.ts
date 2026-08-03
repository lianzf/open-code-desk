import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const workspaceIdSchema = uuidSchema;
export const relativePathSchema = z.string().max(2_048);
export const argumentSchema = z.string().max(32_768);
