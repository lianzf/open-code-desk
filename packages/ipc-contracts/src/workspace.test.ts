import { describe, expect, it } from 'vitest';

import {
  fileChangedEventSchema,
  listDirectoryRequestSchema,
  searchFilesRequestSchema,
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

  it('rejects oversized or empty searches', () => {
    expect(() => searchFilesRequestSchema.parse({ workspaceId, query: '', limit: 100 })).toThrow();
    expect(() =>
      searchFilesRequestSchema.parse({ workspaceId, query: 'src', limit: 201 }),
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
});
