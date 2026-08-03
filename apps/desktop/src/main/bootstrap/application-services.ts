import { join } from 'node:path';

import { app, BrowserWindow, crashReporter } from 'electron';
import electronUpdater from 'electron-updater';
import { updateChannels } from '@open-code-desk/ipc-contracts';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { AgentService } from '../agent/agent.service';
import { AgentTaskRepository } from '../agent/agent-task.repository';
import { ToolApprovalService } from '../agent/tool-approval.service';
import { ToolCallRepository } from '../agent/tool-call.repository';
import { AuditLogService } from '../audit/audit-log.service';
import { ChangeArtifactStore } from '../changes/artifact-store';
import { ChangePathResolver } from '../changes/change-path-resolver';
import { FileChangeRepository } from '../changes/file-change.repository';
import { FileChangeService } from '../changes/file-change.service';
import { FileChangeTransactionService } from '../changes/file-change-transaction.service';
import { CommandRepository } from '../commands/command.repository';
import { CommandService } from '../commands/command.service';
import { PermissionRuleRepository } from '../commands/permission-rule.repository';
import { ContextItemRepository } from '../context/context-item.repository';
import { ContextItemService } from '../context/context-item.service';
import { ElectronContextImagePicker } from '../context/image-context-picker';
import { ProjectRulesService } from '../context/project-rules.service';
import { ConversationRepository } from '../conversations/conversation.repository';
import { ConversationService } from '../conversations/conversation.service';
import { CrashReportService } from '../crash/crash-report.service';
import { createAppDatabase, type AppDatabase } from '../database/database';
import { DebugAdapterRegistry } from '../debug/debug-adapter.registry';
import { BrowserDebugAdapterProvider } from '../debug/browser/browser-debug-adapter.provider';
import { ElectronDebugAdapterProvider } from '../debug/electron/electron-debug-adapter.provider';
import { DotnetDebugAdapterProvider } from '../debug/external/dotnet-debug-adapter.provider';
import { GoDebugAdapterProvider } from '../debug/external/go-debug-adapter.provider';
import { LldbDebugAdapterProvider } from '../debug/external/lldb-debug-adapter.provider';
import { resolveJavaDebugAdapterPaths } from '../debug/java/java-debug-adapter-path';
import { JavaDebugAdapterProvider } from '../debug/java/java-debug-adapter.provider';
import { DebugBreakpointRepository } from '../debug/debug-breakpoint.repository';
import { DebugContextService } from '../debug/debug-context.service';
import { DebugSessionRepository } from '../debug/debug-session.repository';
import { DebugSessionService } from '../debug/debug-session.service';
import { DebugSettingsRepository } from '../debug/debug-settings.repository';
import { DebugWatchRepository } from '../debug/debug-watch.repository';
import { resolveNodeDebugAdapterServerPath } from '../debug/node/node-debug-adapter-path';
import { NodeDebugAdapterProvider } from '../debug/node/node-debug-adapter.provider';
import { resolvePythonDebugAdapterPath } from '../debug/python/python-debug-adapter-path';
import { PythonDebugAdapterProvider } from '../debug/python/python-debug-adapter.provider';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { WorkspaceWatchService } from '../filesystem/workspace-watch.service';
import { GitService } from '../git/git.service';
import { ChatIpcController } from '../ipc/chat.ipc';
import { WorkspacePermissionService } from '../permissions/workspace-permission.service';
import { ExternalDirectoryService } from '../permissions/external-directory.service';
import { WorkspacePathPolicy } from '../permissions/workspace-path-policy';
import { ModelConfigRepository } from '../providers/model-config.repository';
import { ProviderConfigRepository } from '../providers/provider-config.repository';
import { ProviderService } from '../providers/provider.service';
import { registerModelProviders } from '../providers/register-model-providers';
import { ProjectTaskExecutionRepository } from '../project-tasks/project-task-execution.repository';
import { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import { ProjectTaskRepository } from '../project-tasks/project-task.repository';
import { ProjectTaskService } from '../project-tasks/project-task.service';
import { CompoundRunRepository } from '../run/compound-run.repository';
import { CompoundRunService } from '../run/compound-run.service';
import { RunConfigurationRepository } from '../run/run-configuration.repository';
import { RunConfigurationService } from '../run/run-configuration.service';
import { RunExecutionRepository } from '../run/run-execution.repository';
import { RunExecutionService } from '../run/run-execution.service';
import { SecretRepository } from '../security/secret.repository';
import { ElectronSafeStorageCryptography, SecureSecretStore } from '../security/secret-store';
import { AppSettingsRepository } from '../settings/app-settings.repository';
import { AppSettingsService } from '../settings/app-settings.service';
import { TerminalSessionService } from '../terminal/terminal-session.service';
import { ProposalAwarePermissionPolicy } from '../tools/file-proposal-tools';
import { createAgentToolRegistry } from '../tools/register-read-only-tools';
import { UpdateService } from '../updates/update.service';
import { ElectronDirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';

const { autoUpdater } = electronUpdater;

export interface ApplicationServices {
  readonly database: AppDatabase;
  readonly auditLog: AuditLogService;
  readonly workspaceService: WorkspaceService;
  readonly workspaceWatcher: WorkspaceWatchService;
  readonly fileService: WorkspaceFileService;
  readonly gitService: GitService;
  readonly terminalService: TerminalSessionService;
  readonly providerService: ProviderService;
  readonly runConfigurationService: RunConfigurationService;
  readonly runExecutionService: RunExecutionService;
  readonly compoundRunService: CompoundRunService;
  readonly projectTaskService: ProjectTaskService;
  readonly projectTaskExecutionService: ProjectTaskExecutionService;
  readonly debugSessionService: DebugSessionService;
  readonly debugContextService: DebugContextService;
  readonly settingsService: AppSettingsService;
  readonly conversationService: ConversationService;
  readonly crashReportService: CrashReportService;
  readonly updateService: UpdateService;
  readonly contextItemService: ContextItemService;
  readonly changeService: FileChangeService;
  readonly changeTransactions: FileChangeTransactionService;
  readonly commandService: CommandService;
  readonly permissionService: WorkspacePermissionService;
  readonly toolApprovalService: ToolApprovalService;
  readonly chatIpcController: ChatIpcController;
  readonly initialSettings: ReturnType<AppSettingsService['get']>;
}

export async function createApplicationServices(): Promise<ApplicationServices> {
  const database = createAppDatabase(join(app.getPath('userData'), 'open-code-desk.sqlite'));
  const auditLog = new AuditLogService(database);
  const workspaceService = new WorkspaceService(
    new WorkspaceRepository(database),
    new ElectronDirectoryPicker(),
  );
  const permissionRules = new PermissionRuleRepository(database);
  const workspacePathPolicy = new WorkspacePathPolicy(permissionRules);
  const fileService = new WorkspaceFileService(workspaceService, auditLog, workspacePathPolicy);
  const externalDirectories = new ExternalDirectoryService(permissionRules, workspaceService);
  const gitService = new GitService(workspaceService);
  const terminalService = new TerminalSessionService(workspaceService);
  const workspaceWatcher = new WorkspaceWatchService();
  const providerRegistry = new ProviderRegistry();
  registerModelProviders(providerRegistry);
  const secretStore = new SecureSecretStore(
    new SecretRepository(database),
    new ElectronSafeStorageCryptography(),
  );
  const providerConfigRepository = new ProviderConfigRepository(database);
  const providerService = new ProviderService(
    providerConfigRepository,
    new ModelConfigRepository(database),
    secretStore,
    providerRegistry,
  );
  const runConfigurationRepository = new RunConfigurationRepository(database);
  const projectTaskRepository = new ProjectTaskRepository(database);
  const runConfigurationService = new RunConfigurationService(
    runConfigurationRepository,
    secretStore,
    projectTaskRepository,
  );
  const projectTaskService = new ProjectTaskService(
    projectTaskRepository,
    secretStore,
    runConfigurationRepository,
  );
  const projectTaskExecutionRepository = new ProjectTaskExecutionRepository(database);
  projectTaskExecutionRepository.recoverInterrupted();
  const projectTaskExecutionService = new ProjectTaskExecutionService(
    projectTaskRepository,
    projectTaskExecutionRepository,
    workspaceService,
    secretStore,
    undefined,
    auditLog,
  );
  const runExecutionRepository = new RunExecutionRepository(database);
  runExecutionRepository.recoverInterrupted();
  const runExecutionService = new RunExecutionService(
    runConfigurationRepository,
    runExecutionRepository,
    workspaceService,
    secretStore,
    undefined,
    auditLog,
    projectTaskExecutionService,
  );
  const compoundRunService = new CompoundRunService(
    new CompoundRunRepository(database),
    runConfigurationRepository,
    runExecutionService,
    auditLog,
  );
  const debugAdapterRegistry = createDebugAdapterRegistry();
  const debugSessionRepository = new DebugSessionRepository(database);
  debugSessionRepository.recoverInterrupted();
  const debugSessionService = new DebugSessionService(
    runConfigurationRepository,
    debugSessionRepository,
    new DebugBreakpointRepository(database),
    new DebugSettingsRepository(database),
    new DebugWatchRepository(database),
    workspaceService,
    secretStore,
    debugAdapterRegistry,
    auditLog,
    projectTaskExecutionService,
  );
  const settingsService = new AppSettingsService(
    new AppSettingsRepository(database),
    providerConfigRepository,
  );
  const initialSettings = settingsService.get();
  const crashReportService = new CrashReportService(
    database,
    app.getVersion(),
    initialSettings.crashReporting,
  );
  crashReportService.startNativeReporter(crashReporter);
  const updateService = new UpdateService(
    autoUpdater,
    app.isPackaged,
    app.getVersion(),
    (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(updateChannels.statusChanged, status);
      }
    },
  );
  const conversationRepository = new ConversationRepository(database);
  const contextItemRepository = new ContextItemRepository(database);
  const agentTaskRepository = new AgentTaskRepository(database);
  const toolCallRepository = new ToolCallRepository(database, auditLog);
  toolCallRepository.recoverInterrupted();
  const toolApprovalService = new ToolApprovalService(toolCallRepository);
  const commandRepository = new CommandRepository(database);
  const changeRepository = new FileChangeRepository(database);
  const changeArtifacts = new ChangeArtifactStore(
    join(app.getPath('userData'), 'change-artifacts'),
  );
  await changeArtifacts.initialize();
  const changePaths = new ChangePathResolver(workspaceService, workspacePathPolicy);
  const changeService = new FileChangeService(
    changeRepository,
    changeArtifacts,
    changePaths,
    agentTaskRepository,
  );
  const contextItemService = new ContextItemService(
    contextItemRepository,
    conversationRepository,
    new ElectronContextImagePicker(),
  );
  const debugContextService = new DebugContextService(
    debugSessionRepository,
    debugSessionService,
    conversationRepository,
    contextItemService,
    fileService,
    gitService,
    changeService,
    auditLog,
  );
  const changeTransactions = new FileChangeTransactionService(
    changeRepository,
    changeService,
    changeArtifacts,
    changePaths,
    agentTaskRepository,
    undefined,
    auditLog,
  );
  await changeTransactions.recoverInterrupted();
  commandRepository.recoverInterrupted();
  agentTaskRepository.recoverInterrupted();
  const commandService = new CommandService(
    commandRepository,
    permissionRules,
    workspaceService,
    undefined,
    auditLog,
  );
  const conversationService = new ConversationService(
    conversationRepository,
    agentTaskRepository,
    toolCallRepository,
    workspaceService,
  );
  const agentService = new AgentService(
    providerService,
    conversationRepository,
    agentTaskRepository,
    createAgentToolRegistry(
      fileService,
      changeService,
      commandService,
      gitService,
      externalDirectories,
    ),
    toolCallRepository,
    changeService,
    new ProposalAwarePermissionPolicy(permissionRules),
    commandService,
    contextItemRepository,
    new ProjectRulesService(fileService),
    toolApprovalService,
  );
  const permissionService = new WorkspacePermissionService(
    permissionRules,
    workspaceService,
    auditLog,
    new ElectronDirectoryPicker(),
  );
  return {
    database,
    auditLog,
    workspaceService,
    workspaceWatcher,
    fileService,
    gitService,
    terminalService,
    providerService,
    runConfigurationService,
    runExecutionService,
    compoundRunService,
    projectTaskService,
    projectTaskExecutionService,
    debugSessionService,
    debugContextService,
    settingsService,
    conversationService,
    crashReportService,
    updateService,
    contextItemService,
    changeService,
    changeTransactions,
    commandService,
    permissionService,
    toolApprovalService,
    chatIpcController: new ChatIpcController(agentService),
    initialSettings,
  };
}

function createDebugAdapterRegistry(): DebugAdapterRegistry {
  const registry = new DebugAdapterRegistry();
  const javaDebugPaths = resolveJavaDebugAdapterPaths({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });
  const nodeDebugServerPath = resolveNodeDebugAdapterServerPath({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });
  registry.register(
    new NodeDebugAdapterProvider({
      executable: process.execPath,
      serverPath: nodeDebugServerPath,
    }),
  );
  registry.register(
    new BrowserDebugAdapterProvider({
      adapterExecutable: process.execPath,
      adapterServerPath: nodeDebugServerPath,
    }),
  );
  registry.register(
    new ElectronDebugAdapterProvider({
      adapterExecutable: process.execPath,
      adapterServerPath: nodeDebugServerPath,
    }),
  );
  registry.register(
    new PythonDebugAdapterProvider({
      adapterPath: resolvePythonDebugAdapterPath({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
      }),
    }),
  );
  registry.register(new LldbDebugAdapterProvider());
  registry.register(new GoDebugAdapterProvider());
  registry.register(new DotnetDebugAdapterProvider());
  registry.register(new JavaDebugAdapterProvider(javaDebugPaths));
  return registry;
}
