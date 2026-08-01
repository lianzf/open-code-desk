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
  cancelSearch: 'files:cancel-search',
  changed: 'files:changed',
  createDirectory: 'files:create-directory',
  createFile: 'files:create-file',
  deletePath: 'files:delete-path',
  listDirectory: 'files:list-directory',
  movePath: 'files:move-path',
  readFile: 'files:read-file',
  searchFiles: 'files:search-files',
  searchText: 'files:search-text',
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

export const createFileRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
    content: z.string().max(2_000_000).default(''),
  })
  .strict();

export const createDirectoryRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
  })
  .strict();

export const movePathRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sourcePath: relativePathSchema.min(1),
    destinationPath: relativePathSchema.min(1),
  })
  .strict();

export const deletePathRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    relativePath: relativePathSchema.min(1),
    confirmed: z.literal(true),
  })
  .strict();

export const fileMutationResponseSchema = z
  .object({
    relativePath: relativePathSchema.min(1),
  })
  .strict();

export const searchTextRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    workspaceId: workspaceIdSchema,
    query: z.string().min(1).max(1_000),
    path: relativePathSchema.default(''),
    caseSensitive: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

export const textSearchMatchSchema = z
  .object({
    path: relativePathSchema.min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    preview: z.string().max(500),
  })
  .strict();

export const textSearchResponseSchema = z
  .object({
    query: z.string().min(1).max(1_000),
    matches: z.array(textSearchMatchSchema).max(200),
    visitedFiles: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export const cancelFileSearchRequestSchema = z.object({ requestId: z.string().uuid() }).strict();
export const cancelFileSearchResponseSchema = z.object({ cancelled: z.boolean() }).strict();

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
export type CreateFileRequest = z.infer<typeof createFileRequestSchema>;
export type CreateDirectoryRequest = z.infer<typeof createDirectoryRequestSchema>;
export type MovePathRequest = z.infer<typeof movePathRequestSchema>;
export type DeletePathRequest = z.infer<typeof deletePathRequestSchema>;
export type FileMutationResponse = z.infer<typeof fileMutationResponseSchema>;
export type SearchTextRequest = z.infer<typeof searchTextRequestSchema>;
export type TextSearchMatch = z.infer<typeof textSearchMatchSchema>;
export type TextSearchResponse = z.infer<typeof textSearchResponseSchema>;
export type CancelFileSearchRequest = z.infer<typeof cancelFileSearchRequestSchema>;
