import { realpath, stat } from 'node:fs/promises';

import type { WorkspaceInfo } from '@open-code-desk/ipc-contracts';

import type { DirectoryPicker } from './directory-picker';
import type { WorkspaceRepository } from './workspace.repository';

export class WorkspaceService {
  private currentWorkspace: WorkspaceInfo | null = null;

  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly directoryPicker: DirectoryPicker,
  ) {}

  public getCurrent(): WorkspaceInfo | null {
    return this.currentWorkspace;
  }

  public listRecent(): ReadonlyArray<WorkspaceInfo> {
    return this.repository.listRecent();
  }

  public async openFromDialog(): Promise<WorkspaceInfo | null> {
    const selectedPath = await this.directoryPicker.pickDirectory();
    return selectedPath === null ? null : this.openPath(selectedPath);
  }

  public async openRecent(workspaceId: string): Promise<WorkspaceInfo> {
    const workspace = this.repository.findById(workspaceId);

    if (workspace === null) {
      throw new Error('找不到该最近工作区记录。');
    }

    return this.openPath(workspace.rootPath);
  }

  public async getById(workspaceId: string): Promise<WorkspaceInfo> {
    const workspace =
      this.currentWorkspace?.id === workspaceId
        ? this.currentWorkspace
        : this.repository.findById(workspaceId);

    if (workspace === null) {
      throw new Error('工作区不存在或尚未打开。');
    }

    const canonicalPath = await realpath(workspace.rootPath);
    const pathStat = await stat(canonicalPath);

    if (!pathStat.isDirectory()) {
      throw new Error('工作区路径不是目录。');
    }

    return {
      ...workspace,
      rootPath: canonicalPath,
    };
  }

  private async openPath(selectedPath: string): Promise<WorkspaceInfo> {
    const canonicalPath = await realpath(selectedPath);
    const pathStat = await stat(canonicalPath);

    if (!pathStat.isDirectory()) {
      throw new Error('所选路径不是目录。');
    }

    const workspace = this.repository.upsert(canonicalPath);
    this.currentWorkspace = workspace;
    return workspace;
  }
}
