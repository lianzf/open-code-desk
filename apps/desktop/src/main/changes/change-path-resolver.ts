import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { WorkspaceService } from '../workspace/workspace.service';
import {
  isPathInside,
  isSensitiveRelativePath,
  normalizeRelativePath,
  toPlatformPath,
} from '../filesystem/path-policy';
import type { WorkspacePathPolicy } from '../permissions/workspace-path-policy';

const maximumFileBytes = 2_000_000;

export interface ResolvedWorkspaceFile {
  readonly rootPath: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly mode: number;
  readonly content: string;
  readonly bytes: Buffer;
}

function decodeUtf8(bytes: Buffer): string {
  if (bytes.includes(0)) {
    throw new Error('Binary files cannot be changed by the text review workflow.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export class ChangePathResolver {
  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly pathPolicy?: WorkspacePathPolicy,
  ) {}

  public async existing(
    workspaceId: string,
    requestedPath: string,
  ): Promise<ResolvedWorkspaceFile> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.safeRelativePath(requestedPath);
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
    const absolutePath = toPlatformPath(workspace.rootPath, relativePath);
    const linkInfo = await lstat(absolutePath);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
      throw new Error('Only regular, non-symbolic-link files can be changed.');
    }
    const canonicalPath = await realpath(absolutePath);
    if (!isPathInside(workspace.rootPath, canonicalPath)) {
      throw new Error('The resolved file path is outside the workspace.');
    }
    if (linkInfo.size > maximumFileBytes) {
      throw new Error('Files larger than 2 MB cannot be changed in the review workflow.');
    }
    const bytes = await readFile(absolutePath);
    return {
      rootPath: workspace.rootPath,
      relativePath,
      absolutePath,
      mode: linkInfo.mode,
      content: decodeUtf8(bytes),
      bytes,
    };
  }

  public async vacant(
    workspaceId: string,
    requestedPath: string,
  ): Promise<{
    readonly rootPath: string;
    readonly relativePath: string;
    readonly absolutePath: string;
  }> {
    const workspace = await this.workspaces.getById(workspaceId);
    const relativePath = this.safeRelativePath(requestedPath);
    this.pathPolicy?.assertAllowed(workspaceId, relativePath);
    const absolutePath = toPlatformPath(workspace.rootPath, relativePath);
    try {
      await lstat(absolutePath);
      throw new Error('The proposed target path already exists.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const canonicalParent = await realpath(dirname(absolutePath));
    const parentInfo = await stat(canonicalParent);
    if (!parentInfo.isDirectory() || !isPathInside(workspace.rootPath, canonicalParent)) {
      throw new Error('The proposed target parent is outside the workspace.');
    }
    return { rootPath: workspace.rootPath, relativePath, absolutePath };
  }

  public async inspect(
    workspaceId: string,
    requestedPath: string,
  ): Promise<ResolvedWorkspaceFile | null> {
    try {
      return await this.existing(workspaceId, requestedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await this.vacant(workspaceId, requestedPath);
      return null;
    }
  }

  public async root(workspaceId: string): Promise<string> {
    return (await this.workspaces.getById(workspaceId)).rootPath;
  }

  private safeRelativePath(requestedPath: string): string {
    const relativePath = normalizeRelativePath(requestedPath);
    if (relativePath === '') {
      throw new Error('A file path is required.');
    }
    if (isSensitiveRelativePath(relativePath)) {
      throw new Error('The requested file is blocked by the sensitive-path policy.');
    }
    return relativePath;
  }
}
