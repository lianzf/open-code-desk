import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { GitDiff, GitStatus } from '@open-code-desk/ipc-contracts';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';

import { isSensitiveRelativePath, normalizeRelativePath } from '../filesystem/path-policy';
import type { WorkspaceService } from '../workspace/workspace.service';

const sensitiveExclusions = [
  ':(exclude).env',
  ':(exclude).env.*',
  ':(exclude).aws/**',
  ':(exclude).azure/**',
  ':(exclude).gnupg/**',
  ':(exclude).ssh/**',
  ':(exclude)id_dsa',
  ':(exclude)id_ecdsa',
  ':(exclude)id_ed25519',
  ':(exclude)id_rsa',
  ':(exclude)*.p12',
  ':(exclude)*.pfx',
  ':(exclude)**/.env',
  ':(exclude)**/.env.*',
  ':(exclude)**/.aws/**',
  ':(exclude)**/.azure/**',
  ':(exclude)**/.gnupg/**',
  ':(exclude)**/.ssh/**',
  ':(exclude)**/id_dsa',
  ':(exclude)**/id_ecdsa',
  ':(exclude)**/id_ed25519',
  ':(exclude)**/id_rsa',
  ':(exclude)**/*.p12',
  ':(exclude)**/*.pfx',
];

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function boundedDiff(
  content: string,
  maximumCharacters: number,
): {
  readonly content: string;
  readonly truncated: boolean;
} {
  if (content.length <= maximumCharacters) {
    return { content, truncated: false };
  }
  const marker = '\n\n... Git diff truncated by OpenCode Desk ...\n\n';
  const available = maximumCharacters - marker.length;
  const head = Math.ceil(available * 0.7);
  return {
    content: `${content.slice(0, head)}${marker}${content.slice(-(available - head))}`,
    truncated: true,
  };
}

function toGitStatus(workspaceId: string, status: StatusResult): GitStatus {
  const conflicted = new Set(status.conflicted);
  return {
    workspaceId,
    isRepository: true,
    ...(status.current === null ? {} : { branch: status.current }),
    ...(status.tracking === null ? {} : { tracking: status.tracking }),
    ahead: status.ahead,
    behind: status.behind,
    detached: status.detached,
    clean: status.files.length === 0,
    files: status.files.map((file) => ({
      path: file.path,
      indexStatus: file.index,
      workingTreeStatus: file.working_dir,
      staged: file.index !== ' ' && file.index !== '?',
      modified: file.working_dir !== ' ' && file.working_dir !== '?',
      untracked: file.index === '?' && file.working_dir === '?',
      conflicted: conflicted.has(file.path),
    })),
  };
}

export class GitService {
  private readonly validatedClients = new Map<
    string,
    { readonly rootPath: string; readonly client: SimpleGit }
  >();

  public constructor(private readonly workspaces: WorkspaceService) {}

  public async status(workspaceId: string): Promise<GitStatus> {
    const client = await this.clientFor(workspaceId);
    if (client === null) {
      return {
        workspaceId,
        isRepository: false,
        ahead: 0,
        behind: 0,
        detached: false,
        clean: true,
        files: [],
      };
    }
    try {
      return toGitStatus(workspaceId, await client.status());
    } catch (error) {
      this.validatedClients.delete(workspaceId);
      throw new Error(
        `无法读取 Git 状态：${error instanceof Error ? error.message : 'Git 命令失败。'}`,
      );
    }
  }

  public async diff(input: {
    readonly workspaceId: string;
    readonly staged: boolean;
    readonly path?: string;
    readonly maxCharacters: number;
  }): Promise<GitDiff> {
    const client = await this.clientFor(input.workspaceId);
    if (client === null) {
      throw new Error('当前工作区不是 Git 仓库。');
    }
    const relativePath = input.path === undefined ? undefined : normalizeRelativePath(input.path);
    if (relativePath !== undefined && isSensitiveRelativePath(relativePath)) {
      throw new Error('安全策略禁止读取该敏感文件的 Git Diff。');
    }
    const pathspec = relativePath === undefined ? ['.', ...sensitiveExclusions] : [relativePath];
    const arguments_ = [
      '--no-ext-diff',
      '--no-textconv',
      ...(input.staged ? ['--cached'] : []),
      '--',
      ...pathspec,
    ];
    try {
      const fullContent = await client.diff(arguments_);
      const bounded = boundedDiff(fullContent, input.maxCharacters);
      return {
        workspaceId: input.workspaceId,
        staged: input.staged,
        ...(relativePath === undefined ? {} : { path: relativePath }),
        content: bounded.content,
        bytes: Buffer.byteLength(fullContent, 'utf8'),
        truncated: bounded.truncated,
      };
    } catch (error) {
      this.validatedClients.delete(input.workspaceId);
      throw new Error(
        `无法读取 Git Diff：${error instanceof Error ? error.message : 'Git 命令失败。'}`,
      );
    }
  }

  private async clientFor(workspaceId: string): Promise<SimpleGit | null> {
    const workspace = await this.workspaces.getById(workspaceId);
    const canonicalWorkspaceRoot = await realpath(workspace.rootPath);
    if (!samePath(canonicalWorkspaceRoot, workspace.rootPath)) {
      this.validatedClients.delete(workspaceId);
      throw new Error('工作区真实路径已发生变化，已阻止继续执行 Git 命令。');
    }
    const cached = this.validatedClients.get(workspaceId);
    if (cached !== undefined && samePath(cached.rootPath, canonicalWorkspaceRoot)) {
      return cached.client;
    }
    const client = simpleGit({
      baseDir: canonicalWorkspaceRoot,
      binary: 'git',
      maxConcurrentProcesses: 1,
      trimmed: false,
      config: ['core.fsmonitor=false'],
      unsafe: { allowUnsafeFsMonitor: true },
    });
    let isRepository: boolean;
    try {
      isRepository = await client.checkIsRepo();
    } catch (error) {
      throw new Error(
        `无法启动 Git：${error instanceof Error ? error.message : '请确认 Git 已安装并可执行。'}`,
      );
    }
    if (!isRepository) {
      return null;
    }
    const repositoryRoot = await realpath((await client.revparse(['--show-toplevel'])).trim());
    if (!samePath(repositoryRoot, canonicalWorkspaceRoot)) {
      throw new Error('Git 仓库根目录不等于当前工作区，已阻止读取工作区外的仓库内容。');
    }
    this.validatedClients.set(workspaceId, {
      rootPath: canonicalWorkspaceRoot,
      client,
    });
    return client;
  }
}
