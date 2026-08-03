import { extname } from 'node:path';

import type {
  FileEntry,
  ReadFileResponse,
  TextSearchResponse,
} from '@open-code-desk/ipc-contracts';

import { normalizeRelativePath } from './path-policy';

const maximumSearchEntries = 20_000;
const maximumTextSearchFiles = 2_000;
const searchableExtensions = new Set([
  '.c',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

export class WorkspaceFileSearch {
  public constructor(
    private readonly listDirectory: (
      workspaceId: string,
      relativePath: string,
    ) => Promise<ReadonlyArray<FileEntry>>,
    private readonly readFile: (
      workspaceId: string,
      relativePath: string,
    ) => Promise<ReadFileResponse>,
  ) {}

  public async searchFiles(
    workspaceId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<FileEntry>> {
    const normalizedQuery = query.toLocaleLowerCase('en-US');
    const queue: string[] = [''];
    const matches: FileEntry[] = [];
    let visited = 0;
    while (queue.length > 0 && matches.length < limit && visited < maximumSearchEntries) {
      signal?.throwIfAborted();
      const directory = queue.shift();
      if (directory === undefined) break;
      const entries = await this.listDirectory(workspaceId, directory);
      for (const entry of entries) {
        signal?.throwIfAborted();
        visited += 1;
        if (
          !entry.restricted &&
          entry.relativePath.toLocaleLowerCase('en-US').includes(normalizedQuery)
        ) {
          matches.push(entry);
          if (matches.length >= limit) break;
        }
        if (entry.kind === 'directory' && !entry.restricted && !entry.symbolicLink) {
          queue.push(entry.relativePath);
        }
        if (visited >= maximumSearchEntries) break;
      }
    }
    return matches;
  }

  public async searchText(
    workspaceId: string,
    query: string,
    requestedPath: string,
    caseSensitive: boolean,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TextSearchResponse> {
    const path = normalizeRelativePath(requestedPath);
    const queue = [path];
    const matches: TextSearchResponse['matches'][number][] = [];
    const needle = caseSensitive ? query : query.toLocaleLowerCase('en-US');
    let visitedFiles = 0;
    while (queue.length > 0 && matches.length < limit && visitedFiles < maximumTextSearchFiles) {
      signal?.throwIfAborted();
      const directory = queue.shift();
      if (directory === undefined) break;
      const entries = await this.listDirectory(workspaceId, directory);
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.restricted || entry.symbolicLink) continue;
        if (entry.kind === 'directory') {
          queue.push(entry.relativePath);
          continue;
        }
        if (!searchableExtensions.has(extname(entry.name).toLocaleLowerCase('en-US'))) continue;
        visitedFiles += 1;
        try {
          const file = await this.readFile(workspaceId, entry.relativePath);
          const lines = file.content.split('\n');
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex] ?? '';
            const searchableLine = caseSensitive ? line : line.toLocaleLowerCase('en-US');
            const column = searchableLine.indexOf(needle);
            if (column !== -1) {
              matches.push({
                path: entry.relativePath,
                line: lineIndex + 1,
                column: column + 1,
                preview: line.trim().slice(0, 500),
              });
              if (matches.length >= limit) break;
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          // Binary, oversized, or concurrently removed files are safely skipped.
        }
      }
    }
    return {
      query,
      matches,
      visitedFiles,
      truncated: matches.length >= limit || visitedFiles >= maximumTextSearchFiles,
    };
  }
}
