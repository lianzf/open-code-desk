import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import type { DebugBreakpoint, DebugBreakpointStatus } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { debugBreakpoints } from '../database/schema';

type DebugBreakpointRow = typeof debugBreakpoints.$inferSelect;

function toBreakpoint(row: DebugBreakpointRow): DebugBreakpoint {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    relativePath: row.relativePath,
    line: row.line,
    ...(row.column === 1 ? {} : { column: row.column }),
    enabled: row.enabled,
    status: row.status,
    ...(row.adapterBreakpointId === null ? {} : { adapterBreakpointId: row.adapterBreakpointId }),
    ...(row.message === null ? {} : { message: row.message }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface SaveDebugBreakpointInput {
  readonly id?: string;
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column?: number;
  readonly enabled: boolean;
}

export class DebugBreakpointRepository {
  public constructor(private readonly database: AppDatabase) {}

  public list(workspaceId: string, relativePath?: string): ReadonlyArray<DebugBreakpoint> {
    const condition =
      relativePath === undefined
        ? eq(debugBreakpoints.workspaceId, workspaceId)
        : and(
            eq(debugBreakpoints.workspaceId, workspaceId),
            eq(debugBreakpoints.relativePath, relativePath),
          );
    return this.database.orm
      .select()
      .from(debugBreakpoints)
      .where(condition)
      .orderBy(asc(debugBreakpoints.relativePath), asc(debugBreakpoints.line))
      .all()
      .map(toBreakpoint);
  }

  public save(input: SaveDebugBreakpointInput): DebugBreakpoint {
    const existing =
      input.id === undefined
        ? undefined
        : this.database.orm
            .select()
            .from(debugBreakpoints)
            .where(eq(debugBreakpoints.id, input.id))
            .get();
    if (existing !== undefined && existing.workspaceId !== input.workspaceId) {
      throw new Error('断点不能移动到其他工作区。');
    }
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(debugBreakpoints)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
        line: input.line,
        column: input.column ?? 1,
        enabled: input.enabled,
        status: input.enabled ? 'pending' : 'disabled',
        adapterBreakpointId: null,
        message: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: debugBreakpoints.id,
        set: {
          relativePath: input.relativePath,
          line: input.line,
          column: input.column ?? 1,
          enabled: input.enabled,
          status: input.enabled ? 'pending' : 'disabled',
          adapterBreakpointId: null,
          message: null,
          updatedAt: now,
        },
      })
      .returning()
      .get();
    return toBreakpoint(row);
  }

  public updateVerification(
    breakpointId: string,
    status: DebugBreakpointStatus,
    adapterBreakpointId?: number,
    message?: string,
  ): DebugBreakpoint {
    const row = this.database.orm
      .update(debugBreakpoints)
      .set({
        status,
        adapterBreakpointId: adapterBreakpointId ?? null,
        message: message ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(debugBreakpoints.id, breakpointId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('找不到断点。');
    }
    return toBreakpoint(row);
  }

  public delete(workspaceId: string, breakpointId: string): boolean {
    return (
      this.database.orm
        .delete(debugBreakpoints)
        .where(
          and(eq(debugBreakpoints.workspaceId, workspaceId), eq(debugBreakpoints.id, breakpointId)),
        )
        .returning({ id: debugBreakpoints.id })
        .get() !== undefined
    );
  }
}
