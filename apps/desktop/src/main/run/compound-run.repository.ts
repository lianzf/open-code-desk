import { and, asc, eq } from 'drizzle-orm';
import type { CompoundRunConfiguration } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { compoundRunConfigurations } from '../database/schema';

export type SaveCompoundRunConfiguration = Omit<
  CompoundRunConfiguration,
  'createdAt' | 'updatedAt'
>;

export class CompoundRunRepository {
  public constructor(private readonly database: AppDatabase) {}

  public findById(id: string): CompoundRunConfiguration | null {
    return (
      this.database.orm
        .select()
        .from(compoundRunConfigurations)
        .where(eq(compoundRunConfigurations.id, id))
        .get() ?? null
    );
  }

  public list(workspaceId: string): ReadonlyArray<CompoundRunConfiguration> {
    return this.database.orm
      .select()
      .from(compoundRunConfigurations)
      .where(eq(compoundRunConfigurations.workspaceId, workspaceId))
      .orderBy(asc(compoundRunConfigurations.name), asc(compoundRunConfigurations.id))
      .all();
  }

  public save(input: SaveCompoundRunConfiguration): CompoundRunConfiguration {
    const existing = this.findById(input.id);
    if (existing !== null && existing.workspaceId !== input.workspaceId) {
      throw new Error('组合运行配置不能移动到其他工作区。');
    }
    const now = new Date().toISOString();
    return this.database.orm
      .insert(compoundRunConfigurations)
      .values({ ...input, createdAt: existing?.createdAt ?? now, updatedAt: now })
      .onConflictDoUpdate({
        target: compoundRunConfigurations.id,
        set: {
          name: input.name,
          configurationIds: [...input.configurationIds],
          stopAllOnSingleFailure: input.stopAllOnSingleFailure,
          updatedAt: now,
        },
      })
      .returning()
      .get();
  }

  public delete(workspaceId: string, id: string): boolean {
    return (
      this.database.orm
        .delete(compoundRunConfigurations)
        .where(
          and(
            eq(compoundRunConfigurations.workspaceId, workspaceId),
            eq(compoundRunConfigurations.id, id),
          ),
        )
        .returning({ id: compoundRunConfigurations.id })
        .get() !== undefined
    );
  }
}
