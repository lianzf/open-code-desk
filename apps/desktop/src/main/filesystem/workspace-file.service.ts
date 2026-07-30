import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, extname } from 'node:path';

import type {
  FileEntry,
  FileMutationResponse,
  ReadFileResponse,
  TextSearchResponse,
  WriteFileResponse,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceService } from '../workspace/workspace.service';
import {
  isIgnoredDirectoryName,
  isPathInside,
  isSensitiveRelativePath,
  normalizeRelativePath,
  toPlatformPath,
} from './path-policy';

const maximumFileBytes = 2_000_000;
const maximumSearchEntries = 10_000;
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

const languageByExtension: Readonly<Record<string, string>> = {
  '.css': 'css',
  '.go': 'go',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.md': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

function contentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function fileLanguage(filePath: string): string {
  return languageByExtension[extname(filePath).toLocaleLowerCase('en-US')] ?? 'plaintext';
}

function decodeText(content: Uint8Array): string {
  if (content.includes(0)) {
    throw new Error('不支持打开二进制文件。');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本。');
  }
}

function joinRelative(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export class WorkspaceFileService {
  public constructor(private readonly workspaces: WorkspaceService) {}

  public async listDirectory(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<ReadonlyArray<FileEntry>> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = normalizeRelativePath(requestedRelativePath);

    if (isSensitiveRelativePath(relativePath)) {
      throw new Error('该目录受敏感路径策略保护。');
    }

    const directoryPath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertExistingPathInside(workspace.rootPath, directoryPath);
    const directoryStat = await stat(directoryPath);

    if (!directoryStat.isDirectory()) {
      throw new Error('请求路径不是目录。');
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter((entry) => !(entry.isDirectory() && isIgnoredDirectoryName(entry.name)))
        .map(async (entry): Promise<FileEntry> => {
          const entryRelativePath = joinRelative(relativePath, entry.name);
          const entryPath = toPlatformPath(workspace.rootPath, entryRelativePath);
          const symbolicLink = entry.isSymbolicLink();
          let restricted = isSensitiveRelativePath(entryRelativePath);
          let kind: FileEntry['kind'] = entry.isDirectory() ? 'directory' : 'file';

          if (symbolicLink) {
            try {
              const targetPath = await realpath(entryPath);
              restricted ||= !isPathInside(workspace.rootPath, targetPath);
              const targetStat = await stat(entryPath);
              kind = targetStat.isDirectory() ? 'directory' : 'file';
            } catch {
              restricted = true;
            }
          }

          return {
            name: entry.name,
            relativePath: entryRelativePath,
            kind,
            restricted,
            symbolicLink,
          };
        }),
    );

    return result.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }

  public async readFile(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<ReadFileResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertReadableRelativePath(requestedRelativePath);
    const filePath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertExistingPathInside(workspace.rootPath, filePath);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      throw new Error('请求路径不是普通文件。');
    }

    if (fileStat.size > maximumFileBytes) {
      throw new Error('文件超过 2 MB，无法在编辑器中打开。');
    }

    const content = await readFile(filePath);
    const text = decodeText(content);

    return {
      relativePath,
      content: text,
      contentHash: contentHash(content),
      size: content.byteLength,
      modifiedAt: fileStat.mtime.toISOString(),
      language: fileLanguage(relativePath),
    };
  }

  public async writeFile(
    workspaceId: string,
    requestedRelativePath: string,
    content: string,
    expectedHash: string,
  ): Promise<WriteFileResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertReadableRelativePath(requestedRelativePath);
    const filePath = toPlatformPath(workspace.rootPath, relativePath);
    const linkStat = await lstat(filePath);

    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      throw new Error('只能保存工作区内已有的普通文本文件。');
    }

    await this.assertExistingPathInside(workspace.rootPath, filePath);
    const canonicalParent = await realpath(dirname(filePath));

    if (!isPathInside(workspace.rootPath, canonicalParent)) {
      throw new Error('文件父目录超出工作区边界。');
    }

    const currentContent = await readFile(filePath);

    if (contentHash(currentContent) !== expectedHash) {
      throw new Error('文件已在磁盘上发生变化，请重新加载后再保存。');
    }

    const nextContent = Buffer.from(content, 'utf8');

    if (nextContent.byteLength > maximumFileBytes) {
      throw new Error('保存内容超过 2 MB 限制。');
    }

    const temporaryPath = `${filePath}.opencode-${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, 'wx', linkStat.mode);

    try {
      await handle.writeFile(nextContent);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    const updatedStat = await stat(filePath);
    return {
      relativePath,
      contentHash: contentHash(nextContent),
      size: nextContent.byteLength,
      modifiedAt: updatedStat.mtime.toISOString(),
    };
  }

  public async createFile(
    workspaceId: string,
    requestedRelativePath: string,
    content: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertMutableRelativePath(requestedRelativePath);
    const filePath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertWritableParentInside(workspace.rootPath, filePath);
    const encodedContent = Buffer.from(content, 'utf8');
    if (encodedContent.byteLength > maximumFileBytes) {
      throw new Error('新文件内容超过 2 MB 限制。');
    }

    const handle = await open(filePath, 'wx');
    let completed = false;
    try {
      await handle.writeFile(encodedContent);
      await handle.sync();
      completed = true;
    } finally {
      await handle.close();
      if (!completed) {
        await unlink(filePath).catch(() => undefined);
      }
    }
    return { relativePath };
  }

  public async createDirectory(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertMutableRelativePath(requestedRelativePath);
    const directoryPath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertWritableParentInside(workspace.rootPath, directoryPath);
    await mkdir(directoryPath);
    return { relativePath };
  }

  public async movePath(
    workspaceId: string,
    requestedSourcePath: string,
    requestedDestinationPath: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const sourcePath = this.assertMutableRelativePath(requestedSourcePath);
    const destinationPath = this.assertMutableRelativePath(requestedDestinationPath);
    if (sourcePath === destinationPath) {
      throw new Error('源路径和目标路径不能相同。');
    }

    const absoluteSource = toPlatformPath(workspace.rootPath, sourcePath);
    const absoluteDestination = toPlatformPath(workspace.rootPath, destinationPath);
    await this.assertExistingPathInside(workspace.rootPath, absoluteSource);
    const sourceStat = await lstat(absoluteSource);
    if (sourceStat.isSymbolicLink()) {
      throw new Error('不允许移动符号链接。');
    }
    if (sourceStat.isDirectory() && isPathInside(absoluteSource, absoluteDestination)) {
      throw new Error('不能把目录移动到其自身内部。');
    }
    await this.assertWritableParentInside(workspace.rootPath, absoluteDestination);

    try {
      await lstat(absoluteDestination);
      throw new Error('目标路径已存在，请选择其他名称。');
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    await rename(absoluteSource, absoluteDestination);
    return { relativePath: destinationPath };
  }

  public async deletePath(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertMutableRelativePath(requestedRelativePath);
    const absolutePath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertExistingPathInside(workspace.rootPath, absolutePath);
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink()) {
      throw new Error('不允许通过文件树删除符号链接。');
    }
    if (pathStat.isDirectory()) {
      await rmdir(absolutePath);
    } else if (pathStat.isFile()) {
      await unlink(absolutePath);
    } else {
      throw new Error('只能删除普通文件或空目录。');
    }
    return { relativePath };
  }

  public async searchFiles(
    workspaceId: string,
    query: string,
    limit: number,
  ): Promise<ReadonlyArray<FileEntry>> {
    const workspace = await this.workspaces.getById(workspaceId);
    const normalizedQuery = query.toLocaleLowerCase('en-US');
    const queue: string[] = [''];
    const matches: FileEntry[] = [];
    let visited = 0;

    while (queue.length > 0 && matches.length < limit && visited < maximumSearchEntries) {
      const directory = queue.shift();

      if (directory === undefined) {
        break;
      }

      const entries = await this.listDirectory(workspace.id, directory);

      for (const entry of entries) {
        visited += 1;

        if (
          !entry.restricted &&
          entry.relativePath.toLocaleLowerCase('en-US').includes(normalizedQuery)
        ) {
          matches.push(entry);
          if (matches.length >= limit) {
            break;
          }
        }

        if (entry.kind === 'directory' && !entry.restricted && !entry.symbolicLink) {
          queue.push(entry.relativePath);
        }

        if (visited >= maximumSearchEntries) {
          break;
        }
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
      if (directory === undefined) {
        break;
      }
      const entries = await this.listDirectory(workspaceId, directory);
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.restricted || entry.symbolicLink) {
          continue;
        }
        if (entry.kind === 'directory') {
          queue.push(entry.relativePath);
          continue;
        }
        if (!searchableExtensions.has(extname(entry.name).toLocaleLowerCase('en-US'))) {
          continue;
        }
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
              if (matches.length >= limit) {
                break;
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
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

  private assertReadableRelativePath(requestedRelativePath: string): string {
    const relativePath = normalizeRelativePath(requestedRelativePath);

    if (relativePath === '') {
      throw new Error('必须指定文件路径。');
    }

    if (isSensitiveRelativePath(relativePath)) {
      throw new Error('该文件受敏感路径策略保护。');
    }

    return relativePath;
  }

  private assertMutableRelativePath(requestedRelativePath: string): string {
    return this.assertReadableRelativePath(requestedRelativePath);
  }

  private async assertWritableParentInside(rootPath: string, candidatePath: string): Promise<void> {
    const canonicalParent = await realpath(dirname(candidatePath));
    if (!isPathInside(rootPath, canonicalParent)) {
      throw new Error('目标父目录超出工作区边界。');
    }
  }

  private async assertExistingPathInside(rootPath: string, candidatePath: string): Promise<void> {
    const canonicalCandidate = await realpath(candidatePath);

    if (!isPathInside(rootPath, canonicalCandidate)) {
      throw new Error('解析后的路径超出工作区边界。');
    }
  }
}
