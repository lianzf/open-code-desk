import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../database/database';
import { appSettings } from '../database/schema';

export class AppSettingsRepository {
  public constructor(private readonly database: AppDatabase) {}

  public get(key: string): unknown | null {
    const row = this.database.orm
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();
    return row?.value ?? null;
  }

  public set(key: string, value: unknown): void {
    const updatedAt = new Date().toISOString();
    this.database.orm
      .insert(appSettings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt },
      })
      .run();
  }

  public delete(key: string): boolean {
    return (
      this.database.orm
        .delete(appSettings)
        .where(eq(appSettings.key, key))
        .returning({ key: appSettings.key })
        .get() !== undefined
    );
  }
}
