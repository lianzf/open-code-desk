import { createHash } from 'node:crypto';
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
    const location = breakpointStorageLocation(input);
    const saved = this.options.repository.save({
      workspaceId: input.workspaceId,
      relativePath: location.relativePath,
      line: location.line,
      enabled: input.enabled,
      kind: input.kind ?? 'line',
      ...(input.functionName === undefined ? {} : { functionName: input.functionName }),
      ...(input.dataId === undefined ? {} : { dataId: input.dataId }),
      ...(input.dataAccessType === undefined ? {} : { dataAccessType: input.dataAccessType }),
      ...(input.condition === undefined ? {} : { condition: input.condition }),
      ...(input.hitCondition === undefined ? {} : { hitCondition: input.hitCondition }),
      ...(input.logMessage === undefined ? {} : { logMessage: input.logMessage }),
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.column === undefined ? {} : { column: input.column }),
    });
    if ((input.kind ?? 'line') === 'line')
      await this.syncFile(input.workspaceId, location.relativePath);
    else await this.syncSpecialBreakpoints(input.workspaceId);
    return (
      this.options.repository.list(input.workspaceId).find((item) => item.id === saved.id) ?? saved
    );
  }

  public async delete(input: DeleteDebugBreakpointRequest): Promise<boolean> {
    const existing = this.options.repository
      .list(input.workspaceId)
      .find((breakpoint) => breakpoint.id === input.breakpointId);
    const deleted = this.options.repository.delete(input.workspaceId, input.breakpointId);
    if (deleted && existing !== undefined) {
      if (existing.kind === 'line') await this.syncFile(input.workspaceId, existing.relativePath);
      else await this.syncSpecialBreakpoints(input.workspaceId);
    }
    return deleted;
  }

  public async refreshAll(workspaceId: string): Promise<void> {
    const paths = new Set(
      this.options.repository
        .list(workspaceId)
        .filter((item) => item.kind === 'line')
        .map((item) => item.relativePath),
    );
    for (const path of paths) await this.syncFile(workspaceId, path);
    await this.syncSpecialBreakpoints(workspaceId);
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
    const values = this.options.repository
      .list(workspaceId, relativePath)
      .filter((breakpoint) => breakpoint.kind === 'line');
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

  private async syncSpecialBreakpoints(workspaceId: string): Promise<void> {
    const adapter = this.options.activeAdapter(workspaceId);
    if (adapter === undefined) {
      this.emit(workspaceId);
      return;
    }
    const all = this.options.repository.list(workspaceId);
    const verified = [
      ...(await adapter.setFunctionBreakpoints(all.filter((item) => item.kind === 'function'))),
      ...(await adapter.setDataBreakpoints(all.filter((item) => item.kind === 'data'))),
    ];
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

function breakpointStorageLocation(input: SaveDebugBreakpointRequest): {
  readonly relativePath: string;
  readonly line: number;
} {
  const kind = input.kind ?? 'line';
  if (kind === 'line') {
    if (input.relativePath === undefined || input.line === undefined) {
      throw new Error('行断点缺少文件位置。');
    }
    return { relativePath: input.relativePath, line: input.line };
  }
  const identity = kind === 'function' ? input.functionName : input.dataId;
  if (identity === undefined) throw new Error('特殊断点缺少调试器标识。');
  const digest = createHash('sha256').update(identity).digest('hex');
  return { relativePath: `@${kind}/${digest}`, line: 1 };
}
