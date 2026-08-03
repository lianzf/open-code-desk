import type {
  ProjectTaskCommandSnapshot,
  ProjectTaskType,
  RunApprovalDecision,
  RunEnvironmentVariable,
  RunExecutionError,
  RunRiskLevel,
  RunStatus,
} from './run';

export interface ProjectTaskDraft {
  readonly workspaceId: string;
  readonly name: string;
  readonly type: ProjectTaskType;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  /** Workspace-relative working directory. An empty string denotes the workspace root. */
  readonly workingDirectory: string;
  readonly environmentVariables: ReadonlyArray<RunEnvironmentVariable>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly timeoutMs: number;
}

export interface ProjectTask extends ProjectTaskDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectTaskExecution {
  readonly id: string;
  readonly workspaceId: string;
  readonly rootTaskId: string;
  readonly restartOfExecutionId?: string;
  readonly plan: ReadonlyArray<ProjectTaskCommandSnapshot>;
  readonly status: RunStatus;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
  readonly approvalDecision?: RunApprovalDecision;
  readonly currentTaskId?: string;
  readonly currentTaskIndex?: number;
  readonly processId?: number;
  readonly outputTail: string;
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly error?: RunExecutionError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvalDecidedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface ProjectTaskOutputEvent {
  readonly type: 'output';
  readonly executionId: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly stream: 'stdout' | 'stderr';
  readonly sequence: number;
  readonly data: string;
  readonly occurredAt: string;
}

export interface ProjectTaskStatusEvent {
  readonly type: 'status';
  readonly execution: ProjectTaskExecution;
  readonly previousStatus?: RunStatus;
  readonly occurredAt: string;
}

export type ProjectTaskEvent = ProjectTaskOutputEvent | ProjectTaskStatusEvent;
