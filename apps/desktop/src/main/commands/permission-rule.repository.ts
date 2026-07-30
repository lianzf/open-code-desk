import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import type { PermissionRule, PermissionRuleKind } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { permissionRules } from '../database/schema';

type PermissionRuleRow = typeof permissionRules.$inferSelect;

function toPermissionRule(row: PermissionRuleRow): PermissionRule {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as PermissionRuleKind,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PermissionRuleRepository {
  public constructor(private readonly database: AppDatabase) {}

  public list(workspaceId: string): ReadonlyArray<PermissionRule> {
    return this.database.orm
      .select()
      .from(permissionRules)
      .where(eq(permissionRules.workspaceId, workspaceId))
      .orderBy(asc(permissionRules.createdAt))
      .all()
      .map(toPermissionRule);
  }

  public upsert(workspaceId: string, kind: PermissionRuleKind, value: string): PermissionRule {
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(permissionRules)
      .values({
        id: randomUUID(),
        workspaceId,
        kind,
        value,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [permissionRules.workspaceId, permissionRules.kind, permissionRules.value],
        set: { updatedAt: now },
      })
      .returning()
      .get();
    return toPermissionRule(row);
  }

  public delete(workspaceId: string, ruleId: string): boolean {
    return (
      Number(
        this.database.orm
          .delete(permissionRules)
          .where(and(eq(permissionRules.id, ruleId), eq(permissionRules.workspaceId, workspaceId)))
          .run().changes,
      ) > 0
    );
  }
}
