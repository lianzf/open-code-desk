import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import type { DebugWatchExpression } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { debugWatches } from '../database/schema';

export class DebugWatchRepository {
  public constructor(private readonly database: AppDatabase) {}

  public list(workspaceId: string): ReadonlyArray<DebugWatchExpression> {
    return this.database.orm
      .select()
      .from(debugWatches)
      .where(eq(debugWatches.workspaceId, workspaceId))
      .orderBy(asc(debugWatches.createdAt), asc(debugWatches.id))
      .all();
  }

  public save(input: {
    readonly id?: string;
    readonly workspaceId: string;
    readonly expression: string;
  }): DebugWatchExpression {
    const existing =
      input.id === undefined
        ? undefined
        : this.database.orm.select().from(debugWatches).where(eq(debugWatches.id, input.id)).get();
    if (existing !== undefined && existing.workspaceId !== input.workspaceId) {
      throw new Error('监视表达式不能移动到其他工作区。');
    }
    const now = new Date().toISOString();
    return this.database.orm
      .insert(debugWatches)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        expression: input.expression,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: debugWatches.id,
        set: { expression: input.expression, updatedAt: now },
      })
      .returning()
      .get();
  }

  public delete(workspaceId: string, watchId: string): boolean {
    return (
      this.database.orm
        .delete(debugWatches)
        .where(and(eq(debugWatches.workspaceId, workspaceId), eq(debugWatches.id, watchId)))
        .returning({ id: debugWatches.id })
        .get() !== undefined
    );
  }
}
