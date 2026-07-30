import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { FileEntry, ReadFileResponse } from '@open-code-desk/ipc-contracts';

import type { PermissionRuleRepository } from '../commands/permission-rule.repository';
import {
  isIgnoredDirectoryName,
  isPathInside,
  isProtectedSystemPath,
  isSensitiveAbsolutePath,
  isSensitiveRelativePath,
  normalizeRelativePath,
  safeExternalDirectoryLabel,
  toPlatformPath,
} from '../filesystem/path-policy';
import type { WorkspaceService } from '../workspace/workspace.service';

const maximumFileBytes = 2_000_000;

function languageForPath(path: string): string {
  return (
    {
      '.css': 'css',
      '.html': 'html',
      '.js': 'javascript',
      '.json': 'json',
      '.jsx': 'javascript',
      '.md': 'markdown',
      '.py': 'python',
      '.rs': 'rust',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.yaml': 'yaml',
      '.yml': 'yaml',
    }[extname(path).toLocaleLowerCase('en-US')] ?? 'plaintext'
  );
}

function decodeText(content: Uint8Array): string {
  if (content.includes(0)) {
    throw new Error('不支持读取二进制文件。');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(content);
}

function joinRelative(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`;
}

export class ExternalDirectoryService {
  public constructor(
    private readonly rules: PermissionRuleRepository,
    private readonly workspaces: WorkspaceService,
  ) {}

  public async listGrants(workspaceId: string) {
    await this.workspaces.getById(workspaceId);
    return this.rules
      .list(workspaceId)
      .filter((rule) => rule.kind === 'external_directory')
      .map((rule) => ({
        id: rule.id,
        name: safeExternalDirectoryLabel(rule.value),
      }));
  }

  public async listDirectory(
    workspaceId: string,
    grantId: string,
    requestedPath: string,
  ): Promise<ReadonlyArray<FileEntry>> {
    const rootPath = await this.resolveGrant(workspaceId, grantId);
    const relativePath = normalizeRelativePath(requestedPath);
    this.assertSafeRelativePath(relativePath);
    const directoryPath = toPlatformPath(rootPath, relativePath);
    const canonicalDirectory = await realpath(directoryPath);
    if (
      !isPathInside(rootPath, canonicalDirectory) ||
      !(await stat(canonicalDirectory)).isDirectory()
    ) {
      throw new Error('外部目录路径无效或已超出授权边界。');
    }
    const entries = await readdir(canonicalDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => !(entry.isDirectory() && isIgnoredDirectoryName(entry.name)))
      .map((entry): FileEntry => {
        const entryRelativePath = joinRelative(relativePath, entry.name);
        return {
          name: entry.name,
          relativePath: entryRelativePath,
          kind: entry.isDirectory() ? 'directory' : 'file',
          restricted: entry.isSymbolicLink() || isSensitiveRelativePath(entryRelativePath),
          symbolicLink: entry.isSymbolicLink(),
        };
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }

  public async readFile(
    workspaceId: string,
    grantId: string,
    requestedPath: string,
  ): Promise<ReadFileResponse> {
    const rootPath = await this.resolveGrant(workspaceId, grantId);
    const relativePath = normalizeRelativePath(requestedPath);
    if (relativePath === '') {
      throw new Error('必须指定外部文件路径。');
    }
    this.assertSafeRelativePath(relativePath);
    const candidate = toPlatformPath(rootPath, relativePath);
    const canonicalPath = await realpath(candidate);
    const fileStat = await stat(canonicalPath);
    if (!isPathInside(rootPath, canonicalPath) || !fileStat.isFile()) {
      throw new Error('外部文件无效或已超出授权边界。');
    }
    if (fileStat.size > maximumFileBytes) {
      throw new Error('外部文件超过 2 MB 读取限制。');
    }
    if (isSensitiveAbsolutePath(canonicalPath)) {
      throw new Error('该外部文件受敏感路径策略保护。');
    }
    const bytes = await readFile(canonicalPath);
    return {
      relativePath,
      content: decodeText(bytes),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      modifiedAt: fileStat.mtime.toISOString(),
      language: languageForPath(relativePath),
    };
  }

  private async resolveGrant(workspaceId: string, grantId: string): Promise<string> {
    await this.workspaces.getById(workspaceId);
    const grant = this.rules
      .list(workspaceId)
      .find((rule) => rule.id === grantId && rule.kind === 'external_directory');
    if (grant === undefined) {
      throw new Error('外部目录授权不存在或不属于当前工作区。');
    }
    const canonicalRoot = await realpath(grant.value);
    if (
      !isPathInside(grant.value, canonicalRoot) ||
      !isPathInside(canonicalRoot, grant.value) ||
      !(await stat(canonicalRoot)).isDirectory() ||
      isSensitiveAbsolutePath(canonicalRoot) ||
      isProtectedSystemPath(canonicalRoot)
    ) {
      throw new Error('外部目录授权已失效或不再安全。');
    }
    return canonicalRoot;
  }

  private assertSafeRelativePath(relativePath: string): void {
    if (isSensitiveRelativePath(relativePath)) {
      throw new Error('该外部路径受敏感路径策略保护。');
    }
  }
}
