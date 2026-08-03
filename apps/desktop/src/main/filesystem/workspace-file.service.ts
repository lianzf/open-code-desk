import { randomUUID } from 'node:crypto';
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
import { dirname } from 'node:path';

import type {
  FileEntry,
  FileMutationResponse,
  ReadFileResponse,
  TextSearchResponse,
  WriteFileResponse,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceService } from '../workspace/workspace.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { WorkspacePathPolicy } from '../permissions/workspace-path-policy';
import {
  isIgnoredDirectoryName,
  isPathInside,
  isSensitiveRelativePath,
  normalizeRelativePath,
  toPlatformPath,
} from './path-policy';
import {
  contentHash,
  decodeText,
  fileLanguage,
  isMissingPathError,
  joinRelative,
  maximumFileBytes,
} from './workspace-file-support';
import { WorkspaceFileSearch } from './workspace-file-search';

export class WorkspaceFileService {
  readonly #search: WorkspaceFileSearch;

  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly audit?: AuditLogService,
    private readonly pathPolicy?: WorkspacePathPolicy,
  ) {
    this.#search = new WorkspaceFileSearch(
      (workspaceId, relativePath) => this.listDirectory(workspaceId, relativePath),
      (workspaceId, relativePath) => this.readFile(workspaceId, relativePath),
    );
  }

  public async listDirectory(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<ReadonlyArray<FileEntry>> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = normalizeRelativePath(requestedRelativePath);
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);

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
          let restricted =
            isSensitiveRelativePath(entryRelativePath) ||
            this.pathPolicy?.isBlocked(workspaceId, entryRelativePath) === true;
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
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
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
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
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
    this.auditMutation(workspaceId, 'file.write', relativePath);
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
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
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
    this.auditMutation(workspaceId, 'file.create', relativePath);
    return { relativePath };
  }

  public async createDirectory(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertMutableRelativePath(requestedRelativePath);
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
    const directoryPath = toPlatformPath(workspace.rootPath, relativePath);
    await this.assertWritableParentInside(workspace.rootPath, directoryPath);
    await mkdir(directoryPath);
    this.auditMutation(workspaceId, 'directory.create', relativePath);
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
    this.pathPolicy?.assertAllowed(workspaceId, sourcePath);
    this.pathPolicy?.assertAllowed(workspaceId, destinationPath);
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
    this.auditMutation(workspaceId, 'path.move', destinationPath, {
      sourcePath,
      destinationPath,
    });
    return { relativePath: destinationPath };
  }

  public async deletePath(
    workspaceId: string,
    requestedRelativePath: string,
  ): Promise<FileMutationResponse> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.assertMutableRelativePath(requestedRelativePath);
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
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
    this.auditMutation(workspaceId, 'path.delete', relativePath, {
      kind: pathStat.isDirectory() ? 'directory' : 'file',
    });
    return { relativePath };
  }

  private auditMutation(
    workspaceId: string,
    action: string,
    relativePath: string,
    metadata: Readonly<Record<string, string>> = {},
  ): void {
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'file_system',
      action,
      outcome: 'succeeded',
      summary: `${action} completed for ${relativePath}.`,
      metadata: { relativePath, ...metadata },
    });
  }

  public async searchFiles(
    workspaceId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<FileEntry>> {
    return this.#search.searchFiles(workspaceId, query, limit, signal);
  }

  public async searchText(
    workspaceId: string,
    query: string,
    requestedPath: string,
    caseSensitive: boolean,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TextSearchResponse> {
    return this.#search.searchText(workspaceId, query, requestedPath, caseSensitive, limit, signal);
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
