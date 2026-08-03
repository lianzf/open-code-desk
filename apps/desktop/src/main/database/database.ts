import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

import { baseDatabaseMigrations } from './database-migrations-base';
import { runtimeDatabaseMigrations } from './database-migrations-runtime';

export interface AppDatabase {
  readonly client: DatabaseSync;
  readonly orm: NodeSQLiteDatabase;
  close(): void;
}

const databaseMigrations = [...baseDatabaseMigrations, ...runtimeDatabaseMigrations] as const;

function migrateDatabase(client: DatabaseSync): void {
  const currentVersion = client.prepare('PRAGMA user_version').get() as
    { readonly user_version: number } | undefined;
  const startingVersion = currentVersion?.user_version ?? 0;

  for (let index = startingVersion; index < databaseMigrations.length; index += 1) {
    const migration = databaseMigrations[index];
    if (migration === undefined) throw new Error(`Missing database migration ${index + 1}.`);
    client.exec('BEGIN IMMEDIATE;');
    try {
      client.exec(migration);
      client.exec(`PRAGMA user_version = ${index + 1};`);
      client.exec('COMMIT;');
    } catch (error) {
      client.exec('ROLLBACK;');
      throw error;
    }
  }
}

export function createAppDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const client = new DatabaseSync(databasePath, { allowExtension: false, timeout: 5_000 });
  client.exec('PRAGMA foreign_keys = ON;');
  client.exec('PRAGMA busy_timeout = 5000;');
  if (databasePath !== ':memory:') {
    client.exec('PRAGMA journal_mode = WAL;');
    client.exec('PRAGMA synchronous = NORMAL;');
  }
  migrateDatabase(client);
  const orm = drizzle({ client });
  return { client, orm, close: () => client.close() };
}
