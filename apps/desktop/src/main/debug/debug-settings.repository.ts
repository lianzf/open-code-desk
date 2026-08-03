import { eq } from 'drizzle-orm';
import type { DebugExceptionPolicy, DebugSettings } from '@open-code-desk/domain';

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
    if (row === undefined) {
      return {
        workspaceId,
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
        updatedAt: defaultUpdatedAt,
      };
    }
    return {
      ...row,
      exceptionBreakTypes: parseTypes(row.exceptionBreakTypes),
      exceptionIgnoreTypes: parseTypes(row.exceptionIgnoreTypes),
    };
  }

  public save(workspaceId: string, policy: DebugExceptionPolicy): DebugSettings {
    const updatedAt = new Date().toISOString();
    const values = {
      workspaceId,
      exceptionPauseMode: policy.exceptionPauseMode,
      exceptionBreakTypes: JSON.stringify(normalizeTypes(policy.exceptionBreakTypes)),
      exceptionIgnoreTypes: JSON.stringify(normalizeTypes(policy.exceptionIgnoreTypes)),
      updatedAt,
    };
    const row = this.database.orm
      .insert(debugSettings)
      .values(values)
      .onConflictDoUpdate({
        target: debugSettings.workspaceId,
        set: values,
      })
      .returning()
      .get();
    return {
      ...row,
      exceptionBreakTypes: parseTypes(row.exceptionBreakTypes),
      exceptionIgnoreTypes: parseTypes(row.exceptionIgnoreTypes),
    };
  }
}

function normalizeTypes(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function parseTypes(value: string): ReadonlyArray<string> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? normalizeTypes(parsed.filter((item): item is string => typeof item === 'string'))
      : [];
  } catch {
    return [];
  }
}
