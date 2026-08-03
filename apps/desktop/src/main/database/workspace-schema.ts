import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    canonicalPath: text('canonical_path').notNull().unique(),
    displayName: text('display_name').notNull(),
    lastOpenedAt: text('last_opened_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('workspaces_last_opened_at_idx').on(table.lastOpenedAt)],
);
