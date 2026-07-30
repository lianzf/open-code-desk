import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

import type { FileEntry, ReadFileResponse, WriteFileResponse } from '@open-code-desk/ipc-contracts';

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

  private async assertExistingPathInside(rootPath: string, candidatePath: string): Promise<void> {
    const canonicalCandidate = await realpath(candidatePath);

    if (!isPathInside(rootPath, canonicalCandidate)) {
      throw new Error('解析后的路径超出工作区边界。');
    }
  }
}
