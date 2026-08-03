export const runtimeDatabaseMigrations = [
  `
    CREATE TABLE run_executions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      configuration_id TEXT NOT NULL,
      restart_of_execution_id TEXT,
      command_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      risk_reasons TEXT NOT NULL,
      approval_digest TEXT NOT NULL,
      approval_decision TEXT,
      process_id INTEGER,
      output_tail TEXT NOT NULL,
      output_bytes INTEGER NOT NULL,
      output_truncated INTEGER NOT NULL,
      exit_code INTEGER,
      termination_signal TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approval_decided_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      CONSTRAINT run_executions_status_check CHECK (status IN (
        'pending_approval', 'starting', 'running', 'stopping',
        'stopped', 'completed', 'failed', 'rejected'
      )),
      CONSTRAINT run_executions_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'blocked')),
      CONSTRAINT run_executions_approval_decision_check
        CHECK (approval_decision IS NULL OR approval_decision IN ('approve', 'reject')),
      CONSTRAINT run_executions_output_bytes_check CHECK (output_bytes >= 0),
      CONSTRAINT run_executions_output_truncated_check CHECK (output_truncated IN (0, 1))
    );
    CREATE INDEX run_executions_workspace_created_idx ON run_executions(workspace_id, created_at);
    CREATE INDEX run_executions_configuration_created_idx
      ON run_executions(configuration_id, created_at);
  `,
  `
    CREATE TABLE debug_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      configuration_id TEXT NOT NULL,
      adapter_type TEXT NOT NULL,
      command_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      risk_reasons TEXT NOT NULL,
      approval_digest TEXT NOT NULL,
      approval_decision TEXT,
      adapter_process_id INTEGER,
      capabilities TEXT,
      pause TEXT,
      output_tail TEXT NOT NULL,
      output_bytes INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approval_decided_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      CONSTRAINT debug_sessions_status_check CHECK (status IN (
        'pending_approval', 'starting', 'running', 'paused', 'stopping',
        'stopped', 'completed', 'failed', 'rejected'
      )),
      CONSTRAINT debug_sessions_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'blocked')),
      CONSTRAINT debug_sessions_approval_decision_check
        CHECK (approval_decision IS NULL OR approval_decision IN ('approve', 'reject')),
      CONSTRAINT debug_sessions_output_bytes_check CHECK (output_bytes >= 0)
    );
    CREATE INDEX debug_sessions_workspace_created_idx ON debug_sessions(workspace_id, created_at);
    CREATE INDEX debug_sessions_configuration_created_idx
      ON debug_sessions(configuration_id, created_at);

    CREATE TABLE debug_breakpoints (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      column INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      adapter_breakpoint_id INTEGER,
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT debug_breakpoints_line_check CHECK (line > 0),
      CONSTRAINT debug_breakpoints_column_check CHECK (column > 0),
      CONSTRAINT debug_breakpoints_enabled_check CHECK (enabled IN (0, 1)),
      CONSTRAINT debug_breakpoints_status_check CHECK (status IN (
        'pending', 'verified', 'unverified', 'disabled', 'error'
      )),
      UNIQUE(workspace_id, relative_path, line, column)
    );
    CREATE INDEX debug_breakpoints_workspace_path_idx
      ON debug_breakpoints(workspace_id, relative_path);

    CREATE TABLE debug_watches (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      expression TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, expression)
    );
    CREATE INDEX debug_watches_workspace_updated_idx ON debug_watches(workspace_id, updated_at);
  `,
  `
    ALTER TABLE debug_breakpoints ADD COLUMN condition TEXT;
    ALTER TABLE debug_breakpoints ADD COLUMN hit_condition TEXT;
    ALTER TABLE debug_breakpoints ADD COLUMN log_message TEXT;

    CREATE TABLE debug_settings (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      exception_pause_mode TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT debug_settings_exception_pause_mode_check CHECK (
        exception_pause_mode IN ('none', 'uncaught', 'all')
      )
    );
  `,
  `
    CREATE TABLE project_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      executable TEXT NOT NULL,
      args TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      environment_variables TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT project_tasks_type_check CHECK (type IN (
        'build', 'clean', 'test', 'start', 'package', 'deploy', 'lint', 'typecheck', 'custom'
      )),
      CONSTRAINT project_tasks_timeout_check CHECK (timeout_ms BETWEEN 1000 AND 86400000),
      UNIQUE(workspace_id, name)
    );
    CREATE INDEX project_tasks_workspace_updated_idx ON project_tasks(workspace_id, updated_at);

    CREATE TABLE project_task_executions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      root_task_id TEXT NOT NULL,
      restart_of_execution_id TEXT,
      plan_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      risk_reasons TEXT NOT NULL,
      approval_digest TEXT NOT NULL,
      approval_decision TEXT,
      current_task_id TEXT,
      current_task_index INTEGER,
      process_id INTEGER,
      output_tail TEXT NOT NULL,
      output_bytes INTEGER NOT NULL,
      output_truncated INTEGER NOT NULL,
      exit_code INTEGER,
      termination_signal TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approval_decided_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      CONSTRAINT project_task_executions_status_check CHECK (status IN (
        'pending_approval', 'starting', 'running', 'stopping',
        'stopped', 'completed', 'failed', 'rejected'
      )),
      CONSTRAINT project_task_executions_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'blocked')),
      CONSTRAINT project_task_executions_approval_decision_check
        CHECK (approval_decision IS NULL OR approval_decision IN ('approve', 'reject')),
      CONSTRAINT project_task_executions_output_bytes_check CHECK (output_bytes >= 0),
      CONSTRAINT project_task_executions_output_truncated_check CHECK (output_truncated IN (0, 1))
    );
    CREATE INDEX project_task_executions_workspace_created_idx
      ON project_task_executions(workspace_id, created_at);
    CREATE INDEX project_task_executions_root_created_idx
      ON project_task_executions(root_task_id, created_at);
  `,
  `ALTER TABLE run_configurations ADD COLUMN port INTEGER;`,
  `
    CREATE TABLE compound_run_configurations (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      configuration_ids TEXT NOT NULL,
      stop_all_on_single_failure INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name),
      CONSTRAINT compound_run_configurations_stop_all_check
        CHECK (stop_all_on_single_failure IN (0, 1))
    );
    CREATE INDEX compound_run_configurations_workspace_updated_idx
      ON compound_run_configurations(workspace_id, updated_at);
  `,
  `
    ALTER TABLE debug_breakpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'line';
    ALTER TABLE debug_breakpoints ADD COLUMN function_name TEXT;
    ALTER TABLE debug_breakpoints ADD COLUMN data_id TEXT;
    ALTER TABLE debug_breakpoints ADD COLUMN data_access_type TEXT;
  `,
  `
    ALTER TABLE debug_settings ADD COLUMN exception_break_types TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE debug_settings ADD COLUMN exception_ignore_types TEXT NOT NULL DEFAULT '[]';
  `,
  `ALTER TABLE run_configurations ADD COLUMN debug_attach TEXT;`,
  `
    CREATE TABLE run_configurations_v18 (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      executable TEXT NOT NULL,
      args TEXT NOT NULL,
      runtime_args TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      environment_variables TEXT NOT NULL,
      environment_file TEXT,
      pre_launch_task_id TEXT,
      post_run_task_id TEXT,
      console TEXT NOT NULL,
      auto_generated INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      port INTEGER,
      debug_attach TEXT,
      CONSTRAINT run_configurations_v18_auto_generated_check CHECK (auto_generated IN (0, 1)),
      CONSTRAINT run_configurations_v18_console_check CHECK (console IN ('integratedTerminal', 'runOutput')),
      CONSTRAINT run_configurations_v18_type_check CHECK (type IN (
        'node', 'typescript', 'react', 'vue', 'nextjs', 'electron', 'java-maven',
        'java-gradle', 'spring-boot', 'python', 'c', 'cpp', 'dotnet',
        'go', 'rust', 'script', 'custom'
      ))
    );
    INSERT INTO run_configurations_v18 (
      id, workspace_id, name, type, executable, args, runtime_args, working_directory,
      environment_variables, environment_file, pre_launch_task_id, post_run_task_id,
      console, auto_generated, created_at, updated_at, port, debug_attach
    )
    SELECT
      id, workspace_id, name, type, executable, args, runtime_args, working_directory,
      environment_variables, environment_file, pre_launch_task_id, post_run_task_id,
      console, auto_generated, created_at, updated_at, port, debug_attach
    FROM run_configurations;

    CREATE TABLE workspace_run_settings_v18 (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      default_configuration_id TEXT REFERENCES run_configurations_v18(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO workspace_run_settings_v18 (workspace_id, default_configuration_id, updated_at)
    SELECT workspace_id, default_configuration_id, updated_at FROM workspace_run_settings;

    DROP TABLE workspace_run_settings;
    DROP TABLE run_configurations;
    ALTER TABLE run_configurations_v18 RENAME TO run_configurations;
    ALTER TABLE workspace_run_settings_v18 RENAME TO workspace_run_settings;
    CREATE UNIQUE INDEX run_configurations_workspace_name_idx
      ON run_configurations(workspace_id, name);
    CREATE INDEX run_configurations_workspace_updated_idx
      ON run_configurations(workspace_id, updated_at);
  `,
] as const;
