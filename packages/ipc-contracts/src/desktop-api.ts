import type { HealthRequest, HealthResponse } from './health';
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
  WorkspaceRulesRequest,
} from './commands';
import type {
  Conversation,
  ConversationDetail,
  ConversationIdRequest,
  CreateConversationRequest,
  ListConversationsRequest,
  RenameConversationRequest,
} from './conversations';
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
  FileChangedEvent,
  FileEntry,
  ListDirectoryRequest,
  OpenRecentWorkspaceRequest,
  ReadFileRequest,
  ReadFileResponse,
  SearchFilesRequest,
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
import type { GitDiff, GitDiffRequest, GitStatus, GitStatusRequest } from './git';

export interface DesktopApi {
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
    listDirectory(input: ListDirectoryRequest): Promise<ReadonlyArray<FileEntry>>;
    readFile(input: ReadFileRequest): Promise<ReadFileResponse>;
    searchFiles(input: SearchFilesRequest): Promise<ReadonlyArray<FileEntry>>;
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
  };
  readonly terminal: {
    create(input: CreateTerminalRequest): Promise<TerminalSessionInfo>;
    write(input: TerminalWriteRequest): Promise<{ readonly accepted: boolean }>;
    resize(input: TerminalResizeRequest): Promise<{ readonly accepted: boolean }>;
    close(input: TerminalSessionRequest): Promise<{ readonly accepted: boolean }>;
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
  };
  readonly git: {
    status(input: GitStatusRequest): Promise<GitStatus>;
    diff(input: GitDiffRequest): Promise<GitDiff>;
  };
}
