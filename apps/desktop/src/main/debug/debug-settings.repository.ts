import { eq } from 'drizzle-orm';
import type { DebugExceptionPauseMode, DebugSettings } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { debugSettings } from '../database/schema';

const defaultUpdatedAt = new Date(0).toISOString();

export class DebugSettingsRepository {
  public constructor(private readonly database: AppDatabase) {}

  public get(workspaceId: string): DebugSettings {
    const row = this.database.orm
      .select()
      .from(debugSettings)
      .where(eq(debugSettings.workspaceId, workspaceId))
      .get();
    return row ?? { workspaceId, exceptionPauseMode: 'uncaught', updatedAt: defaultUpdatedAt };
  }

  public save(workspaceId: string, exceptionPauseMode: DebugExceptionPauseMode): DebugSettings {
    const updatedAt = new Date().toISOString();
    return this.database.orm
      .insert(debugSettings)
      .values({ workspaceId, exceptionPauseMode, updatedAt })
      .onConflictDoUpdate({
        target: debugSettings.workspaceId,
        set: { exceptionPauseMode, updatedAt },
      })
      .returning()
      .get();
  }
}
