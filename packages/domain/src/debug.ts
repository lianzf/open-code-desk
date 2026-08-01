import type { RunCommandSnapshot, RunRiskLevel } from './run';

export type DebugSessionStatus =
  | 'pending_approval'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'rejected';

export type DebugBreakpointStatus = 'pending' | 'verified' | 'unverified' | 'disabled' | 'error';

export interface DebugAdapterCapabilities {
  readonly pause: boolean;
  readonly restart: boolean;
  readonly stepBack: boolean;
  readonly setVariable: boolean;
  readonly conditionalBreakpoints: boolean;
  readonly functionBreakpoints: boolean;
  readonly exceptionInfo: boolean;
}

export interface DebugAdapterProvider {
  readonly type: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  validateConfiguration(configuration: RunCommandSnapshot): Promise<DebugValidationResult>;
}

export interface DebugValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export interface DebugSessionError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface DebugPauseLocation {
  readonly threadId: number;
  readonly reason: string;
  readonly description?: string;
  readonly relativePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly frameId?: number;
  readonly exception?: DebugExceptionInfo;
}

export interface DebugExceptionInfo {
  readonly exceptionId: string;
  readonly description?: string;
  readonly breakMode?: string;
  readonly typeName?: string;
  readonly message?: string;
  readonly stackTrace?: string;
}

export interface DebugSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly adapterType: string;
  readonly command: RunCommandSnapshot;
  readonly status: DebugSessionStatus;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
  readonly approvalDecision?: 'approve' | 'reject';
  readonly adapterProcessId?: number;
  readonly capabilities?: DebugAdapterCapabilities;
  readonly pause?: DebugPauseLocation;
  readonly outputTail: string;
  readonly outputBytes: number;
  readonly error?: DebugSessionError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvalDecidedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface DebugBreakpoint {
  readonly id: string;
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column?: number;
  readonly enabled: boolean;
  readonly status: DebugBreakpointStatus;
  readonly adapterBreakpointId?: number;
  readonly message?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DebugThread {
  readonly id: number;
  readonly name: string;
}

export interface DebugStackFrame {
  readonly id: number;
  readonly name: string;
  readonly sourceName?: string;
  readonly relativePath?: string;
  readonly line: number;
  readonly column: number;
}

export interface DebugScope {
  readonly name: string;
  readonly variablesReference: number;
  readonly expensive: boolean;
}

export interface DebugVariable {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly variablesReference: number;
  readonly evaluateName?: string;
}

export interface DebugWatchExpression {
  readonly id: string;
  readonly workspaceId: string;
  readonly expression: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DebugEvaluationResult {
  readonly expression: string;
  readonly result: string;
  readonly type?: string;
  readonly variablesReference: number;
}

export type DebugContextSectionKey =
  | 'location'
  | 'source'
  | 'exception'
  | 'stack'
  | 'variables'
  | 'watches'
  | 'console'
  | 'configuration'
  | 'git_diff'
  | 'recent_changes'
  | 'dependencies';

/** A bounded, redacted section shown to the user before it can reach a model. */
export interface DebugContextSection {
  readonly key: DebugContextSectionKey;
  readonly title: string;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly redactionCount: number;
  readonly truncated: boolean;
  readonly selectedByDefault: boolean;
}

/**
 * A short-lived renderer-safe preview. Raw debugger values are never retained
 * in this object: every section has already crossed the main-process sanitizer.
 */
export interface DebugContextSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly pauseFingerprint: string;
  readonly digest: string;
  readonly sections: ReadonlyArray<DebugContextSection>;
  readonly totalTokenEstimate: number;
  readonly totalRedactionCount: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type DebugOutputCategory = 'console' | 'stdout' | 'stderr' | 'telemetry' | 'important';

export type DebugEvent =
  | {
      readonly type: 'status';
      readonly session: DebugSession;
      readonly previousStatus?: DebugSessionStatus;
      readonly occurredAt: string;
    }
  | {
      readonly type: 'output';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly category: DebugOutputCategory;
      readonly sequence: number;
      readonly data: string;
      readonly occurredAt: string;
    }
  | {
      readonly type: 'breakpoints';
      readonly workspaceId: string;
      readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
      readonly occurredAt: string;
    };
