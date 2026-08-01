import { isAbsolute, relative, resolve } from 'node:path';

import type { DebugBreakpoint, DebugEvent } from '@open-code-desk/domain';
import type {
  DeleteDebugBreakpointRequest,
  ListDebugBreakpointsRequest,
  SaveDebugBreakpointRequest,
} from '@open-code-desk/ipc-contracts';

import { isPathInside } from '../filesystem/path-policy';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterEvent, DebugAdapterSession } from './debug-adapter';
import type { DebugBreakpointRepository } from './debug-breakpoint.repository';

export interface DebugBreakpointCoordinatorOptions {
  readonly repository: DebugBreakpointRepository;
  readonly workspaces: WorkspaceService;
  readonly activeAdapter: (workspaceId: string) => DebugAdapterSession | undefined;
  readonly emit: (event: DebugEvent) => void;
}

export class DebugBreakpointCoordinator {
  public constructor(private readonly options: DebugBreakpointCoordinatorOptions) {}

  public list(input: ListDebugBreakpointsRequest): ReadonlyArray<DebugBreakpoint> {
    return this.options.repository.list(input.workspaceId, input.relativePath);
  }

  public listWorkspace(workspaceId: string): ReadonlyArray<DebugBreakpoint> {
    return this.options.repository.list(workspaceId);
  }

  public async save(input: SaveDebugBreakpointRequest): Promise<DebugBreakpoint> {
    const saved = this.options.repository.save({
      workspaceId: input.workspaceId,
      relativePath: input.relativePath,
      line: input.line,
      enabled: input.enabled,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.column === undefined ? {} : { column: input.column }),
    });
    await this.syncFile(input.workspaceId, input.relativePath);
    return (
      this.options.repository
        .list(input.workspaceId, input.relativePath)
        .find((item) => item.id === saved.id) ?? saved
    );
  }

  public async delete(input: DeleteDebugBreakpointRequest): Promise<boolean> {
    const existing = this.options.repository
      .list(input.workspaceId)
      .find((breakpoint) => breakpoint.id === input.breakpointId);
    const deleted = this.options.repository.delete(input.workspaceId, input.breakpointId);
    if (deleted && existing !== undefined) {
      await this.syncFile(input.workspaceId, existing.relativePath);
    }
    return deleted;
  }

  public async refreshAll(workspaceId: string): Promise<void> {
    const paths = new Set(
      this.options.repository.list(workspaceId).map((item) => item.relativePath),
    );
    for (const path of paths) await this.syncFile(workspaceId, path);
  }

  public async updateFromAdapter(
    workspaceId: string,
    event: Extract<DebugAdapterEvent, { type: 'breakpoint' }>,
  ): Promise<void> {
    const all = this.options.repository.list(workspaceId);
    const relativePath = await this.relativeAdapterPath(workspaceId, event.sourcePath);
    const match = all.find(
      (item) =>
        (event.adapterBreakpointId !== undefined &&
          item.adapterBreakpointId === event.adapterBreakpointId) ||
        (relativePath !== undefined &&
          item.relativePath === relativePath &&
          item.line === event.line),
    );
    if (match === undefined) return;
    this.options.repository.updateVerification(
      match.id,
      event.verified ? 'verified' : 'unverified',
      event.adapterBreakpointId,
      event.message,
    );
    this.emit(workspaceId);
  }

  private async syncFile(workspaceId: string, relativePath: string): Promise<void> {
    const adapter = this.options.activeAdapter(workspaceId);
    if (adapter === undefined) {
      this.emit(workspaceId);
      return;
    }
    const values = this.options.repository.list(workspaceId, relativePath);
    const verified = await adapter.setBreakpoints(relativePath, values);
    for (const breakpoint of verified) {
      this.options.repository.updateVerification(
        breakpoint.id,
        breakpoint.status,
        breakpoint.adapterBreakpointId,
        breakpoint.message,
      );
    }
    this.emit(workspaceId);
  }

  private async relativeAdapterPath(
    workspaceId: string,
    sourcePath?: string,
  ): Promise<string | undefined> {
    if (sourcePath === undefined || !isAbsolute(sourcePath)) return undefined;
    const root = (await this.options.workspaces.getById(workspaceId)).rootPath;
    const absolute = resolve(sourcePath);
    return isPathInside(root, absolute)
      ? relative(root, absolute).replaceAll('\\', '/')
      : undefined;
  }

  private emit(workspaceId: string): void {
    this.options.emit({
      type: 'breakpoints',
      workspaceId,
      breakpoints: this.options.repository.list(workspaceId),
      occurredAt: new Date().toISOString(),
    });
  }
}
