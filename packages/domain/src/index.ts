export type AgentStatus =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'waiting_for_approval'
  | 'executing_tool'
  | 'editing_files'
  | 'running_tests'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AppErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_TOO_LARGE'
  | 'FILE_ACCESS_DENIED'
  | 'WORKSPACE_BOUNDARY_VIOLATION'
  | 'COMMAND_REJECTED'
  | 'COMMAND_FAILED'
  | 'PATCH_CONFLICT'
  | 'DATABASE_ERROR'
  | 'VALIDATION_ERROR'
  | 'CANCELLED'
  | 'UNKNOWN_ERROR';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly causeId?: string;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly lastOpenedAt: string;
}

export type WorkspaceEntryKind = 'file' | 'directory';

export interface WorkspaceEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly restricted: boolean;
  readonly symbolicLink: boolean;
}

export type ConversationStatus = 'active' | 'archived';

export interface Conversation {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly providerConfigId?: string;
  readonly modelId?: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled';

export interface MessageToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly reasoning: string;
  readonly toolCallId?: string;
  readonly toolCalls: ReadonlyArray<MessageToolCall>;
  readonly sequence: number;
  readonly modelId?: string;
  readonly status: MessageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTask {
  readonly id: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly status: AgentStatus;
  readonly attempt: number;
  readonly checkpoint?: Readonly<Record<string, unknown>>;
  readonly error?: AppError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export type ToolCallStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected';

export interface ToolCallRecord {
  readonly id: string;
  readonly taskId: string;
  readonly conversationId: string;
  readonly toolName: string;
  readonly permissionLevel: 'read' | 'write' | 'execute' | 'dangerous';
  readonly input: unknown;
  readonly status: ToolCallStatus;
  readonly output?: unknown;
  readonly error?: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
  }>;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContextItem {
  readonly id: string;
  readonly type:
    | 'file'
    | 'selection'
    | 'directory'
    | 'git_diff'
    | 'terminal'
    | 'diagnostic'
    | 'text'
    | 'summary';
  readonly title: string;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly priority: number;
}

export interface ConversationContextItem extends ContextItem {
  readonly conversationId: string;
  readonly sourceKey?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type FileChangeOperation = 'create' | 'update' | 'delete' | 'rename';

export type FileChangeStatus =
  'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'rolled_back';

export type FileChangeSetStatus =
  | 'pending_review'
  | 'ready_to_apply'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'cancelled';

/**
 * A proposed workspace mutation. File contents are stored outside SQLite in
 * the private artifact store and referenced by digest.
 */
export interface FileChange {
  readonly id: string;
  readonly changeSetId: string;
  readonly sequence: number;
  readonly filePath: string;
  readonly destinationPath?: string;
  readonly operation: FileChangeOperation;
  readonly originalArtifactRef?: string;
  readonly proposedArtifactRef?: string;
  readonly snapshotArtifactRef?: string;
  readonly baselineHash?: string;
  readonly proposedHash?: string;
  readonly appliedHash?: string;
  readonly diff: string;
  readonly reviewDigest: string;
  readonly status: FileChangeStatus;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly rolledBackAt?: string;
}

export interface FileChangeSet {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: FileChangeSetStatus;
  readonly applyDigest?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly rolledBackAt?: string;
}

export type CommandRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export type CommandExecutionStatus =
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'timed_out';

export interface CommandExecution {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly modelToolCallId: string;
  readonly toolName: 'run_command' | 'run_tests';
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly riskLevel: CommandRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
  readonly status: CommandExecutionStatus;
  readonly autoApproved: boolean;
  readonly outputTail: string;
  readonly outputBytes: number;
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly error?: AppError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export type PermissionRuleKind = 'allow_executable' | 'deny_executable' | 'allow_network_commands';

export interface PermissionRule {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: PermissionRuleKind;
  readonly value: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
