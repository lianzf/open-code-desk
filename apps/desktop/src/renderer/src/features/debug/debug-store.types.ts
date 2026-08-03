import type {
  DebugBreakpoint,
  DebugContextSectionKey,
  DebugContextSnapshot,
  DebugEvaluationResult,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugSettings,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  DebugWatchExpression,
} from '@open-code-desk/ipc-contracts';

export interface DebugConsoleEntry {
  readonly id: string;
  readonly category:
    'console' | 'stdout' | 'stderr' | 'telemetry' | 'important' | 'input' | 'result';
  readonly data: string;
}

export interface DebugBreakpointEditorTarget {
  readonly relativePath: string;
  readonly line: number;
  readonly column?: number;
}

export interface DebugBreakpointDefinition extends DebugBreakpointEditorTarget {
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
}

export type DebugSpecialBreakpointDefinition =
  | {
      readonly id?: string;
      readonly kind: 'function';
      readonly functionName: string;
      readonly condition?: string;
      readonly hitCondition?: string;
    }
  | {
      readonly id?: string;
      readonly kind: 'data';
      readonly dataId: string;
      readonly dataAccessType: 'read' | 'write' | 'readWrite';
      readonly condition?: string;
      readonly hitCondition?: string;
    };

export interface DebugState {
  readonly workspaceId: string | undefined;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly sessions: ReadonlyArray<DebugSession>;
  readonly selectedSessionId: string | undefined;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly settings: DebugSettings | undefined;
  readonly breakpointEditor: DebugBreakpointEditorTarget | undefined;
  readonly watches: ReadonlyArray<DebugWatchExpression>;
  readonly threads: ReadonlyArray<DebugThread>;
  readonly selectedThreadId: number | undefined;
  readonly stackFrames: ReadonlyArray<DebugStackFrame>;
  readonly selectedFrameId: number | undefined;
  readonly scopes: ReadonlyArray<DebugScope>;
  readonly variables: Readonly<Record<number, ReadonlyArray<DebugVariable>>>;
  readonly watchResults: Readonly<Record<string, DebugEvaluationResult | string>>;
  readonly consoleEntries: ReadonlyArray<DebugConsoleEntry>;
  readonly contextPreview: DebugContextSnapshot | undefined;
  readonly contextLoading: boolean;
  readonly errorMessage: string | undefined;
  initialize(workspaceId: string): Promise<void>;
  dispose(): void;
  proposeStart(configurationId: string): Promise<DebugSession | undefined>;
  decideStart(sessionId: string, decision: 'approve' | 'reject'): Promise<void>;
  stop(sessionId?: string): Promise<void>;
  restart(sessionId?: string): Promise<void>;
  control(action: 'pause' | 'continue' | 'next' | 'stepIn' | 'stepOut'): Promise<void>;
  runToCursor(relativePath: string, line: number, column?: number): Promise<void>;
  toggleBreakpoint(relativePath: string, line: number): Promise<void>;
  openBreakpointEditor(relativePath: string, line: number, column?: number): void;
  closeBreakpointEditor(): void;
  saveBreakpointDefinition(input: DebugBreakpointDefinition): Promise<void>;
  saveSpecialBreakpoint(input: DebugSpecialBreakpointDefinition): Promise<void>;
  setBreakpointEnabled(breakpointId: string, enabled: boolean): Promise<void>;
  setExceptionPauseMode(mode: DebugSettings['exceptionPauseMode']): Promise<void>;
  setExceptionPolicy(
    exceptionBreakTypes: ReadonlyArray<string>,
    exceptionIgnoreTypes: ReadonlyArray<string>,
  ): Promise<void>;
  deleteBreakpoint(breakpointId: string): Promise<void>;
  deleteBreakpointsForFile(relativePath: string): Promise<void>;
  deleteAllBreakpoints(): Promise<void>;
  selectThread(threadId: number): Promise<void>;
  selectFrame(frameId: number): Promise<void>;
  expandVariables(reference: number): Promise<void>;
  addWatch(expression: string): Promise<void>;
  deleteWatch(watchId: string): Promise<void>;
  evaluate(
    expression: string,
    context?: 'watch' | 'repl' | 'hover',
  ): Promise<DebugEvaluationResult | undefined>;
  clearConsole(): void;
  previewContext(conversationId: string): Promise<DebugContextSnapshot | undefined>;
  attachContext(
    conversationId: string,
    selectedSections: ReadonlyArray<DebugContextSectionKey>,
  ): Promise<{ readonly prompt: string } | undefined>;
  clearContextPreview(): void;
  notify(event: DebugEvent): void;
}
