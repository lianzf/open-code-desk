import { z } from 'zod';

const workspaceIdSchema = z.string().uuid();
const relativePathSchema = z.string().max(2_048);

export const workspaceChannels = {
  getCurrent: 'workspace:get-current',
  listRecent: 'workspace:list-recent',
  openDialog: 'workspace:open-dialog',
  openRecent: 'workspace:open-recent',
} as const;

export const workspaceInfoSchema = z
  .object({
    id: workspaceIdSchema,
    name: z.string().min(1).max(255),
    rootPath: z.string().min(1).max(32_768),
    lastOpenedAt: z.string().datetime(),
  })
  .strict();

export const workspaceInfoListSchema = z.array(workspaceInfoSchema).max(20);
export const nullableWorkspaceInfoSchema = workspaceInfoSchema.nullable();

export const openRecentWorkspaceRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict();

export const filesChannels = {
  changed: 'files:changed',
  listDirectory: 'files:list-directory',
  readFile: 'files:read-file',
  searchFiles: 'files:search-files',
  writeFile: 'files:write-file',
} as const;

export const fileChangedEventSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
    event: z.enum(['changed', 'renamed']),
  })
  .strict();

export const fileEntrySchema = z
  .object({
    name: z.string().min(1).max(255),
    relativePath: relativePathSchema,
    kind: z.enum(['file', 'directory']),
    restricted: z.boolean(),
    symbolicLink: z.boolean(),
  })
  .strict();

export const fileEntryListSchema = z.array(fileEntrySchema).max(1_000);

export const listDirectoryRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema,
  })
  .strict();

export const readFileRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
  })
  .strict();

export const readFileResponseSchema = z
  .object({
    relativePath: relativePathSchema.min(1),
    content: z.string().max(2_000_000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().datetime(),
    language: z.string().min(1).max(50),
  })
  .strict();

export const writeFileRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
    content: z.string().max(2_000_000),
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const writeFileResponseSchema = z
  .object({
    relativePath: relativePathSchema.min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().datetime(),
  })
  .strict();

export const searchFilesRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;
export type OpenRecentWorkspaceRequest = z.infer<typeof openRecentWorkspaceRequestSchema>;
export type FileEntry = z.infer<typeof fileEntrySchema>;
export type FileChangedEvent = z.infer<typeof fileChangedEventSchema>;
export type ListDirectoryRequest = z.infer<typeof listDirectoryRequestSchema>;
export type ReadFileRequest = z.infer<typeof readFileRequestSchema>;
export type ReadFileResponse = z.infer<typeof readFileResponseSchema>;
export type WriteFileRequest = z.infer<typeof writeFileRequestSchema>;
export type WriteFileResponse = z.infer<typeof writeFileResponseSchema>;
export type SearchFilesRequest = z.infer<typeof searchFilesRequestSchema>;
