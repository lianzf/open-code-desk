import { describe, expect, it } from 'vitest';

import {
  createFileRequestSchema,
  deletePathRequestSchema,
  fileChangedEventSchema,
  listDirectoryRequestSchema,
  searchFilesRequestSchema,
  searchTextRequestSchema,
  writeFileRequestSchema,
} from './workspace';

const workspaceId = 'a5d6f8f9-ec3a-4fb6-87c4-076b90b7d27c';

describe('workspace IPC contracts', () => {
  it('accepts a root directory listing request', () => {
    expect(listDirectoryRequestSchema.parse({ workspaceId, relativePath: '' })).toEqual({
      workspaceId,
      relativePath: '',
    });
  });

  it('validates cancellable filename searches and rejects invalid limits', () => {
    const requestId = '6f674acb-f7a0-46ee-9f23-d74933ba7618';
    expect(
      searchFilesRequestSchema.parse({ requestId, workspaceId, query: 'src', limit: 100 }),
    ).toEqual({ requestId, workspaceId, query: 'src', limit: 100 });
    expect(() =>
      searchFilesRequestSchema.parse({ requestId, workspaceId, query: '', limit: 100 }),
    ).toThrow();
    expect(() =>
      searchFilesRequestSchema.parse({ requestId, workspaceId, query: 'src', limit: 201 }),
    ).toThrow();
  });

  it('rejects a write request with an invalid baseline hash', () => {
    expect(() =>
      writeFileRequestSchema.parse({
        workspaceId,
        relativePath: 'src/index.ts',
        content: 'export {};',
        expectedHash: 'not-a-hash',
      }),
    ).toThrow();
  });

  it('validates file-system change notifications', () => {
    expect(
      fileChangedEventSchema.parse({
        workspaceId,
        relativePath: 'src/index.ts',
        event: 'changed',
      }),
    ).toEqual({
      workspaceId,
      relativePath: 'src/index.ts',
      event: 'changed',
    });
  });

  it('requires explicit delete confirmation and validates cancellable text searches', () => {
    expect(
      createFileRequestSchema.parse({
        workspaceId,
        relativePath: 'src/new.ts',
      }),
    ).toEqual({
      workspaceId,
      relativePath: 'src/new.ts',
      content: '',
    });
    expect(() =>
      deletePathRequestSchema.parse({
        workspaceId,
        relativePath: 'src/new.ts',
        confirmed: false,
      }),
    ).toThrow();
    expect(
      searchTextRequestSchema.parse({
        requestId: '6f674acb-f7a0-46ee-9f23-d74933ba7618',
        workspaceId,
        query: 'needle',
      }),
    ).toMatchObject({
      path: '',
      caseSensitive: false,
      limit: 100,
    });
  });
});
