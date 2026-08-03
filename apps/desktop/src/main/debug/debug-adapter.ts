import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugExceptionPolicy,
  DebugExceptionInfo,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugValidationResult,
  DebugVariable,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

export interface DebugAdapterLaunchInput {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly command: RunCommandSnapshot;
  readonly environment: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly exceptionPolicy: DebugExceptionPolicy;
}

export type DebugAdapterEvent =
  | {
      readonly type: 'output';
      readonly category: 'console' | 'stdout' | 'stderr' | 'telemetry' | 'important';
      readonly data: string;
    }
  | {
      readonly type: 'stopped';
      readonly threadId: number;
      readonly reason: string;
      readonly description?: string;
    }
  | { readonly type: 'continued'; readonly threadId?: number }
  | { readonly type: 'terminated'; readonly restart: boolean }
  | {
      readonly type: 'breakpoint';
      readonly adapterBreakpointId?: number;
      readonly verified: boolean;
      readonly message?: string;
      readonly line?: number;
      readonly column?: number;
      readonly sourcePath?: string;
    };

export interface DebugAdapterSession {
  readonly processId: number;
  readonly capabilities: DebugAdapterCapabilities;
  subscribe(listener: (event: DebugAdapterEvent) => void): () => void;
  continue(threadId: number): Promise<void>;
  pause(threadId: number): Promise<void>;
  next(threadId: number): Promise<void>;
  stepIn(threadId: number): Promise<void>;
  stepOut(threadId: number): Promise<void>;
  threads(): Promise<ReadonlyArray<DebugThread>>;
  stackTrace(threadId: number): Promise<ReadonlyArray<DebugStackFrame>>;
  scopes(frameId: number): Promise<ReadonlyArray<DebugScope>>;
  variables(variablesReference: number): Promise<ReadonlyArray<DebugVariable>>;
  evaluate(
    expression: string,
    frameId: number | undefined,
    context: 'watch' | 'repl' | 'hover',
  ): Promise<DebugEvaluationResult>;
  exceptionInfo(threadId: number): Promise<DebugExceptionInfo | undefined>;
  setBreakpoints(
    relativePath: string,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  setFunctionBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  setDataBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  setExceptionBreakpoints(policy: DebugExceptionPolicy): Promise<void>;
  runToCursor(threadId: number, relativePath: string, line: number, column?: number): Promise<void>;
  restart(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface RuntimeDebugAdapterProvider {
  readonly type: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  validateConfiguration(configuration: RunCommandSnapshot): Promise<DebugValidationResult>;
  createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession>;
}
