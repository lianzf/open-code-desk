import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const workspaceIdSchema = uuidSchema;
export const sessionIdSchema = uuidSchema;
export const relativePathSchema = z.string().min(1).max(2_048);
export const dapReferenceSchema = z.number().int().nonnegative();
