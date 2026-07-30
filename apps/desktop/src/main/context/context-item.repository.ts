import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import type { ContextItem, ConversationContextItem } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { contextItems } from '../database/schema';

type ContextItemRow = typeof contextItems.$inferSelect;

export interface SaveContextItem {
  readonly conversationId: string;
  readonly type: ContextItem['type'];
  readonly title: string;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly priority: number;
  readonly sourceKey?: string;
}

function toContextItem(row: ContextItemRow): ConversationContextItem {
  return {
    id: row.id,
    conversationId: row.conversationId,
    type: row.type as ContextItem['type'],
    title: row.title,
    content: row.content,
    tokenEstimate: row.tokenEstimate,
    priority: row.priority,
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ContextItemRepository {
  public constructor(private readonly database: AppDatabase) {}

  public list(conversationId: string): ReadonlyArray<ConversationContextItem> {
    return this.database.orm
      .select()
      .from(contextItems)
      .where(eq(contextItems.conversationId, conversationId))
      .orderBy(desc(contextItems.priority), contextItems.createdAt)
      .limit(1_000)
      .all()
      .map(toContextItem);
  }

  public save(input: SaveContextItem): ConversationContextItem {
    const now = new Date().toISOString();
    const existing =
      input.sourceKey === undefined
        ? undefined
        : this.database.orm
            .select()
            .from(contextItems)
            .where(
              and(
                eq(contextItems.conversationId, input.conversationId),
                eq(contextItems.sourceKey, input.sourceKey),
              ),
            )
            .get();
    if (existing !== undefined) {
      return toContextItem(
        this.database.orm
          .update(contextItems)
          .set({
            type: input.type,
            title: input.title,
            content: input.content,
            tokenEstimate: input.tokenEstimate,
            priority: input.priority,
            updatedAt: now,
          })
          .where(eq(contextItems.id, existing.id))
          .returning()
          .get(),
      );
    }

    return toContextItem(
      this.database.orm
        .insert(contextItems)
        .values({
          id: randomUUID(),
          conversationId: input.conversationId,
          type: input.type,
          title: input.title,
          content: input.content,
          tokenEstimate: input.tokenEstimate,
          priority: input.priority,
          sourceKey: input.sourceKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
  }

  public delete(conversationId: string, contextItemId: string): boolean {
    return (
      Number(
        this.database.orm
          .delete(contextItems)
          .where(
            and(
              eq(contextItems.id, contextItemId),
              eq(contextItems.conversationId, conversationId),
            ),
          )
          .run().changes,
      ) > 0
    );
  }
}
