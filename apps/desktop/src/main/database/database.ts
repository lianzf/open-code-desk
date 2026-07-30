import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

export interface AppDatabase {
  readonly client: DatabaseSync;
  readonly orm: NodeSQLiteDatabase;
  close(): void;
}

const databaseMigrations = [
  `
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      canonical_path TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspaces_last_opened_at_idx
      ON workspaces(last_opened_at);

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      default_model TEXT NOT NULL,
      fast_model TEXT,
      reasoning_model TEXT,
      context_window INTEGER NOT NULL,
      tool_calling INTEGER NOT NULL,
      vision INTEGER NOT NULL,
      streaming INTEGER NOT NULL,
      custom_headers TEXT NOT NULL,
      sensitive_header_names TEXT NOT NULL,
      has_api_key INTEGER NOT NULL,
      secret_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_configs_kind_idx
      ON provider_configs(kind);
    CREATE INDEX IF NOT EXISTS provider_configs_updated_at_idx
      ON provider_configs(updated_at);

    CREATE TABLE IF NOT EXISTS secure_secrets (
      ref TEXT PRIMARY KEY NOT NULL,
      encrypted_value BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      provider_config_id TEXT REFERENCES provider_configs(id) ON DELETE SET NULL,
      model_id TEXT,
      status TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_workspace_updated_idx
      ON conversations(workspace_id, updated_at);
    CREATE INDEX IF NOT EXISTS conversations_deleted_at_idx
      ON conversations(deleted_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      tool_call_id TEXT,
      tool_calls TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      model_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_sequence_idx
      ON messages(conversation_id, sequence);

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      checkpoint TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS agent_tasks_conversation_updated_idx
      ON agent_tasks(conversation_id, updated_at);
    CREATE INDEX IF NOT EXISTS agent_tasks_status_idx
      ON agent_tasks(status);

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      permission_level TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tool_calls_task_created_idx
      ON tool_calls(task_id, created_at);
    CREATE INDEX IF NOT EXISTS tool_calls_conversation_created_idx
      ON tool_calls(conversation_id, created_at);
  `,
  `
    CREATE TABLE file_change_sets (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      apply_digest TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT,
      rolled_back_at TEXT
    );
    CREATE INDEX file_change_sets_conversation_updated_idx
      ON file_change_sets(conversation_id, updated_at);
    CREATE INDEX file_change_sets_task_idx
      ON file_change_sets(task_id);
    CREATE INDEX file_change_sets_status_idx
      ON file_change_sets(status);

    CREATE TABLE file_changes (
      id TEXT PRIMARY KEY NOT NULL,
      change_set_id TEXT NOT NULL REFERENCES file_change_sets(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      destination_path TEXT,
      operation TEXT NOT NULL,
      original_artifact_ref TEXT,
      proposed_artifact_ref TEXT,
      snapshot_artifact_ref TEXT,
      baseline_hash TEXT,
      proposed_hash TEXT,
      applied_hash TEXT,
      diff TEXT NOT NULL,
      review_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT,
      rolled_back_at TEXT,
      UNIQUE(change_set_id, sequence)
    );
    CREATE INDEX file_changes_set_sequence_idx
      ON file_changes(change_set_id, sequence);
    CREATE INDEX file_changes_set_status_idx
      ON file_changes(change_set_id, status);
  `,
  `
    CREATE TABLE command_executions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      model_tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      executable TEXT NOT NULL,
      args TEXT NOT NULL,
      cwd TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      risk_reasons TEXT NOT NULL,
      approval_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      auto_approved INTEGER NOT NULL,
      output_tail TEXT NOT NULL,
      output_bytes INTEGER NOT NULL,
      exit_code INTEGER,
      termination_signal TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(task_id, model_tool_call_id)
    );
    CREATE INDEX command_executions_conversation_created_idx
      ON command_executions(conversation_id, created_at);
    CREATE INDEX command_executions_task_created_idx
      ON command_executions(task_id, created_at);
    CREATE INDEX command_executions_status_idx
      ON command_executions(status);

    CREATE TABLE permission_rules (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, kind, value)
    );
    CREATE INDEX permission_rules_workspace_kind_idx
      ON permission_rules(workspace_id, kind);
  `,
  `
    CREATE TABLE context_items (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      source_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX context_items_conversation_priority_idx
      ON context_items(conversation_id, priority, created_at);
    CREATE UNIQUE INDEX context_items_conversation_source_idx
      ON context_items(conversation_id, source_key);
  `,
  `
    CREATE TABLE model_configs (
      id TEXT PRIMARY KEY NOT NULL,
      provider_config_id TEXT NOT NULL
        REFERENCES provider_configs(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      owned_by TEXT,
      context_window INTEGER,
      max_output_tokens INTEGER,
      streaming INTEGER,
      tool_calling INTEGER,
      vision INTEGER,
      reasoning INTEGER,
      structured_output INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider_config_id, model_id)
    );
    CREATE INDEX model_configs_provider_updated_idx
      ON model_configs(provider_config_id, updated_at);

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
      actor TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX audit_events_workspace_created_idx
      ON audit_events(workspace_id, created_at);
    CREATE INDEX audit_events_conversation_created_idx
      ON audit_events(conversation_id, created_at);
    CREATE INDEX audit_events_category_created_idx
      ON audit_events(category, created_at);
  `,
] as const;

function migrateDatabase(client: DatabaseSync): void {
  const currentVersion = client.prepare('PRAGMA user_version').get() as
    { readonly user_version: number } | undefined;
  const startingVersion = currentVersion?.user_version ?? 0;

  for (let index = startingVersion; index < databaseMigrations.length; index += 1) {
    const migration = databaseMigrations[index];
    if (migration === undefined) {
      throw new Error(`Missing database migration ${index + 1}.`);
    }
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
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const client = new DatabaseSync(databasePath, {
    allowExtension: false,
    timeout: 5_000,
  });

  client.exec('PRAGMA foreign_keys = ON;');
  client.exec('PRAGMA busy_timeout = 5000;');

  if (databasePath !== ':memory:') {
    client.exec('PRAGMA journal_mode = WAL;');
    client.exec('PRAGMA synchronous = NORMAL;');
  }

  migrateDatabase(client);

  const orm = drizzle({ client });

  return {
    client,
    orm,
    close() {
      client.close();
    },
  };
}
