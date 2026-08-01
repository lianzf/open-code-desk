import type { HealthRequest, HealthResponse } from './health';
import type { AuditEvent, ListAuditEventsRequest } from './audit';
import type {
  CancelChatRequest,
  ChatStreamEvent,
  StartChatRequest,
  StartChatResponse,
} from './chat';
import type {
  ApplyChangeSetRequest,
  ChangeContents,
  ChangeContentsRequest,
  ChangeSetIdRequest,
  EditChangeProposalRequest,
  FileChangeSet,
  ListChangeSetsRequest,
  ReviewChangeRequest,
  ReviewManyChangesRequest,
} from './changes';
import type {
  CommandExecution,
  CommandIdRequest,
  DecideCommandRequest,
  DeletePermissionRuleRequest,
  ListCommandsRequest,
  PermissionRule,
  SetNetworkAccessRequest,
  UpsertExecutableRuleRequest,
  WorkspaceRulesRequest,
} from './commands';
import type {
  ContextConversationRequest,
  ConversationContextItem,
  DeleteConversationContextRequest,
  SaveConversationContextRequest,
} from './context';
import type {
  Conversation,
  ConversationDetail,
  ConversationIdRequest,
  CreateConversationRequest,
  ListConversationsRequest,
  RenameConversationRequest,
} from './conversations';
import type {
  AcknowledgeCrashReportRequest,
  CrashReport,
  ListCrashReportsRequest,
} from './crash-reports';
import type {
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugEvent,
  DebugFrameRequest,
  DebugScope,
  DebugSession,
  DebugSessionRequest,
  DebugStackFrame,
  DebugThread,
  DebugThreadRequest,
  DebugVariable,
  DebugVariablesRequest,
  DebugWatchExpression,
  DecideDebugStartRequest,
  DeleteDebugBreakpointRequest,
  DeleteDebugWatchRequest,
  EvaluateDebugRequest,
  ListDebugBreakpointsRequest,
  ListDebugHistoryRequest,
  ListDebugWatchesRequest,
  ProposeDebugStartRequest,
  RunToCursorRequest,
  SaveDebugBreakpointRequest,
  SaveDebugWatchRequest,
} from './debug';
import type {
  AttachDebugContextRequest,
  AttachDebugContextResponse,
  DebugContextSnapshot,
  PreviewDebugContextRequest,
} from './debug-context';
import type {
  ConnectionTestResult,
  DeleteProviderRequest,
  ModelInfo,
  ProviderConfig,
  ProviderDescriptor,
  ProviderIdRequest,
  SaveProviderRequest,
} from './providers';
import type {
  DecideRunStartRequest,
  DeleteRunConfigurationRequest,
  DetectProjectRequest,
  ListRunHistoryRequest,
  ListRunConfigurationsRequest,
  PendingRunExecution,
  ProjectDetection,
  ProposeRunStartRequest,
  RestartRunExecutionRequest,
  RunConfiguration,
  RunConfigurationList,
  RunEvent,
  RunExecution,
  SaveRunConfigurationRequest,
  SetDefaultRunConfigurationRequest,
  SetDefaultRunConfigurationResponse,
  StopRunExecutionRequest,
} from './run';
import type { AppSettings, UpdateAppSettingsRequest } from './settings';
import type {
  CancelFileSearchRequest,
  CreateDirectoryRequest,
  CreateFileRequest,
  DeletePathRequest,
  FileChangedEvent,
  FileEntry,
  FileMutationResponse,
  ListDirectoryRequest,
  MovePathRequest,
  OpenRecentWorkspaceRequest,
  ReadFileRequest,
  ReadFileResponse,
  SearchFilesRequest,
  SearchTextRequest,
  TextSearchResponse,
  WorkspaceInfo,
  WriteFileRequest,
  WriteFileResponse,
} from './workspace';
import type {
  CreateTerminalRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalResizeRequest,
  TerminalSessionInfo,
  TerminalSessionRequest,
  TerminalWriteRequest,
} from './terminal';
import type { UpdateStatus } from './updates';
import type { GitDiff, GitDiffRequest, GitStatus, GitStatusRequest } from './git';
import type {
  AddBlockedPathRequest,
  DecideToolApprovalRequest,
  GrantExternalDirectoryRequest,
  SetReadAutoAllowRequest,
} from './permissions';

export interface DesktopApi {
  readonly audit: {
    list(input: ListAuditEventsRequest): Promise<ReadonlyArray<AuditEvent>>;
  };
  readonly app: {
    health(input: HealthRequest): Promise<HealthResponse>;
  };
  readonly workspace: {
    getCurrent(): Promise<WorkspaceInfo | null>;
    listRecent(): Promise<ReadonlyArray<WorkspaceInfo>>;
    openDialog(): Promise<WorkspaceInfo | null>;
    openRecent(input: OpenRecentWorkspaceRequest): Promise<WorkspaceInfo>;
  };
  readonly files: {
    onChanged(listener: (event: FileChangedEvent) => void): () => void;
    cancelSearch(input: CancelFileSearchRequest): Promise<{ readonly cancelled: boolean }>;
    createDirectory(input: CreateDirectoryRequest): Promise<FileMutationResponse>;
    createFile(input: CreateFileRequest): Promise<FileMutationResponse>;
    deletePath(input: DeletePathRequest): Promise<FileMutationResponse>;
    listDirectory(input: ListDirectoryRequest): Promise<ReadonlyArray<FileEntry>>;
    movePath(input: MovePathRequest): Promise<FileMutationResponse>;
    readFile(input: ReadFileRequest): Promise<ReadFileResponse>;
    searchFiles(input: SearchFilesRequest): Promise<ReadonlyArray<FileEntry>>;
    searchText(input: SearchTextRequest): Promise<TextSearchResponse>;
    writeFile(input: WriteFileRequest): Promise<WriteFileResponse>;
  };
  readonly providers: {
    list(): Promise<ReadonlyArray<ProviderConfig>>;
    listKinds(): Promise<ReadonlyArray<ProviderDescriptor>>;
    save(input: SaveProviderRequest): Promise<ProviderConfig>;
    delete(input: DeleteProviderRequest): Promise<{ readonly deleted: true }>;
    testConnection(input: ProviderIdRequest): Promise<ConnectionTestResult>;
    listModels(input: ProviderIdRequest): Promise<ReadonlyArray<ModelInfo>>;
  };
  readonly run: {
    detect(input: DetectProjectRequest): Promise<ProjectDetection>;
    list(input: ListRunConfigurationsRequest): Promise<RunConfigurationList>;
    save(input: SaveRunConfigurationRequest): Promise<RunConfiguration>;
    delete(input: DeleteRunConfigurationRequest): Promise<{ readonly deleted: boolean }>;
    setDefault(
      input: SetDefaultRunConfigurationRequest,
    ): Promise<SetDefaultRunConfigurationResponse>;
    proposeStart(input: ProposeRunStartRequest): Promise<PendingRunExecution>;
    decideStart(input: DecideRunStartRequest): Promise<RunExecution>;
    stop(input: StopRunExecutionRequest): Promise<RunExecution>;
    restart(input: RestartRunExecutionRequest): Promise<PendingRunExecution>;
    listHistory(input: ListRunHistoryRequest): Promise<ReadonlyArray<RunExecution>>;
    onEvent(listener: (event: RunEvent) => void): () => void;
  };
  readonly debug: {
    proposeStart(input: ProposeDebugStartRequest): Promise<DebugSession>;
    decideStart(input: DecideDebugStartRequest): Promise<DebugSession>;
    stop(input: DebugSessionRequest): Promise<DebugSession>;
    restart(input: DebugSessionRequest): Promise<DebugSession>;
    pause(input: DebugThreadRequest): Promise<DebugSession>;
    continue(input: DebugThreadRequest): Promise<DebugSession>;
    next(input: DebugThreadRequest): Promise<DebugSession>;
    stepIn(input: DebugThreadRequest): Promise<DebugSession>;
    stepOut(input: DebugThreadRequest): Promise<DebugSession>;
    runToCursor(input: RunToCursorRequest): Promise<DebugSession>;
    listHistory(input: ListDebugHistoryRequest): Promise<ReadonlyArray<DebugSession>>;
    listBreakpoints(input: ListDebugBreakpointsRequest): Promise<ReadonlyArray<DebugBreakpoint>>;
    saveBreakpoint(input: SaveDebugBreakpointRequest): Promise<DebugBreakpoint>;
    deleteBreakpoint(input: DeleteDebugBreakpointRequest): Promise<{ readonly accepted: boolean }>;
    threads(input: DebugSessionRequest): Promise<ReadonlyArray<DebugThread>>;
    stackTrace(input: DebugThreadRequest): Promise<ReadonlyArray<DebugStackFrame>>;
    scopes(input: DebugFrameRequest): Promise<ReadonlyArray<DebugScope>>;
    variables(input: DebugVariablesRequest): Promise<ReadonlyArray<DebugVariable>>;
    evaluate(input: EvaluateDebugRequest): Promise<DebugEvaluationResult>;
    listWatches(input: ListDebugWatchesRequest): Promise<ReadonlyArray<DebugWatchExpression>>;
    saveWatch(input: SaveDebugWatchRequest): Promise<DebugWatchExpression>;
    deleteWatch(input: DeleteDebugWatchRequest): Promise<{ readonly accepted: boolean }>;
    previewContext(input: PreviewDebugContextRequest): Promise<DebugContextSnapshot>;
    attachContext(input: AttachDebugContextRequest): Promise<AttachDebugContextResponse>;
    onEvent(listener: (event: DebugEvent) => void): () => void;
  };
  readonly settings: {
    get(): Promise<AppSettings>;
    update(input: UpdateAppSettingsRequest): Promise<AppSettings>;
  };
  readonly conversations: {
    list(input: ListConversationsRequest): Promise<ReadonlyArray<Conversation>>;
    create(input: CreateConversationRequest): Promise<Conversation>;
    get(input: ConversationIdRequest): Promise<ConversationDetail>;
    rename(input: RenameConversationRequest): Promise<Conversation>;
    delete(input: ConversationIdRequest): Promise<{ readonly deleted: true }>;
    exportMarkdown(
      input: ConversationIdRequest,
    ): Promise<{ readonly saved: boolean; readonly path?: string | undefined }>;
  };
  readonly crashReports: {
    list(input: ListCrashReportsRequest): Promise<ReadonlyArray<CrashReport>>;
    acknowledge(input: AcknowledgeCrashReportRequest): Promise<{ readonly acknowledged: boolean }>;
  };
  readonly chat: {
    start(input: StartChatRequest): Promise<StartChatResponse>;
    cancel(input: CancelChatRequest): Promise<{ readonly cancelled: boolean }>;
    onStreamEvent(listener: (event: ChatStreamEvent) => void): () => void;
  };
  readonly changes: {
    listForConversation(input: ListChangeSetsRequest): Promise<ReadonlyArray<FileChangeSet>>;
    get(input: ChangeSetIdRequest): Promise<FileChangeSet>;
    getContents(input: ChangeContentsRequest): Promise<ChangeContents>;
    review(input: ReviewChangeRequest): Promise<FileChangeSet>;
    reviewMany(input: ReviewManyChangesRequest): Promise<FileChangeSet>;
    editProposal(input: EditChangeProposalRequest): Promise<FileChangeSet>;
    apply(input: ApplyChangeSetRequest): Promise<FileChangeSet>;
    rollback(input: ApplyChangeSetRequest): Promise<FileChangeSet>;
  };
  readonly commands: {
    listForConversation(input: ListCommandsRequest): Promise<ReadonlyArray<CommandExecution>>;
    decide(input: DecideCommandRequest): Promise<CommandExecution>;
    cancel(input: CommandIdRequest): Promise<{ readonly accepted: boolean }>;
    listRules(input: WorkspaceRulesRequest): Promise<ReadonlyArray<PermissionRule>>;
    deleteRule(input: DeletePermissionRuleRequest): Promise<{ readonly deleted: boolean }>;
    setNetworkAccess(input: SetNetworkAccessRequest): Promise<ReadonlyArray<PermissionRule>>;
    upsertExecutableRule(input: UpsertExecutableRuleRequest): Promise<PermissionRule>;
  };
  readonly permissions: {
    addBlockedPath(input: AddBlockedPathRequest): Promise<PermissionRule>;
    decideTool(input: DecideToolApprovalRequest): Promise<{ readonly accepted: boolean }>;
    deleteRule(input: DeletePermissionRuleRequest): Promise<{ readonly deleted: boolean }>;
    grantExternalDirectory(input: GrantExternalDirectoryRequest): Promise<PermissionRule | null>;
    listRules(input: WorkspaceRulesRequest): Promise<ReadonlyArray<PermissionRule>>;
    setReadAutoAllow(input: SetReadAutoAllowRequest): Promise<ReadonlyArray<PermissionRule>>;
  };
  readonly context: {
    list(input: ContextConversationRequest): Promise<ReadonlyArray<ConversationContextItem>>;
    pickImage(input: ContextConversationRequest): Promise<ConversationContextItem | null>;
    save(input: SaveConversationContextRequest): Promise<ConversationContextItem>;
    delete(input: DeleteConversationContextRequest): Promise<{ readonly deleted: boolean }>;
  };
  readonly terminal: {
    create(input: CreateTerminalRequest): Promise<TerminalSessionInfo>;
    write(input: TerminalWriteRequest): Promise<{ readonly accepted: boolean }>;
    resize(input: TerminalResizeRequest): Promise<{ readonly accepted: boolean }>;
    close(input: TerminalSessionRequest): Promise<{ readonly accepted: boolean }>;
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
  };
  readonly updates: {
    getStatus(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): Promise<{ readonly accepted: true }>;
    onStatusChanged(listener: (status: UpdateStatus) => void): () => void;
  };
  readonly git: {
    status(input: GitStatusRequest): Promise<GitStatus>;
    diff(input: GitDiffRequest): Promise<GitDiff>;
  };
}
