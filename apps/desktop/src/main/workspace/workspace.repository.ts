import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { desc, eq } from 'drizzle-orm';
import type { WorkspaceInfo } from '@open-code-desk/ipc-contracts';

import type { AppDatabase } from '../database/database';
import { workspaces } from '../database/schema';

interface WorkspaceRow {
  readonly id: string;
  readonly canonicalPath: string;
  readonly displayName: string;
  readonly lastOpenedAt: string;
}

function toWorkspaceInfo(row: WorkspaceRow): WorkspaceInfo {
  return {
    id: row.id,
    name: row.displayName,
    rootPath: row.canonicalPath,
    lastOpenedAt: row.lastOpenedAt,
  };
}

export class WorkspaceRepository {
  public constructor(private readonly database: AppDatabase) {}

  public upsert(canonicalPath: string): WorkspaceInfo {
    const now = new Date().toISOString();
    const displayName = basename(canonicalPath) || canonicalPath;
    const inserted = this.database.orm
      .insert(workspaces)
      .values({
        id: randomUUID(),
        canonicalPath,
        displayName,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaces.canonicalPath,
        set: {
          displayName,
          lastOpenedAt: now,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    return toWorkspaceInfo(inserted);
  }

  public findById(workspaceId: string): WorkspaceInfo | null {
    const row = this.database.orm
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();

    return row === undefined ? null : toWorkspaceInfo(row);
  }

  public listRecent(limit = 10): ReadonlyArray<WorkspaceInfo> {
    return this.database.orm
      .select()
      .from(workspaces)
      .orderBy(desc(workspaces.lastOpenedAt))
      .limit(limit)
      .all()
      .map(toWorkspaceInfo);
  }
}
