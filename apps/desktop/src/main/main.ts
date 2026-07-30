import { join } from 'node:path';

import { app, BrowserWindow, crashReporter, dialog, nativeTheme } from 'electron';
import electronUpdater from 'electron-updater';
import { updateChannels } from '@open-code-desk/ipc-contracts';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { AgentService } from './agent/agent.service';
import { AgentTaskRepository } from './agent/agent-task.repository';
import { ToolCallRepository } from './agent/tool-call.repository';
import { AuditLogService, redactAuditText } from './audit/audit-log.service';
import { ChangeArtifactStore } from './changes/artifact-store';
import { ChangePathResolver } from './changes/change-path-resolver';
import { FileChangeRepository } from './changes/file-change.repository';
import { FileChangeService } from './changes/file-change.service';
import { FileChangeTransactionService } from './changes/file-change-transaction.service';
import { CommandRepository } from './commands/command.repository';
import { CommandService } from './commands/command.service';
import { PermissionRuleRepository } from './commands/permission-rule.repository';
import { ContextItemRepository } from './context/context-item.repository';
import { ContextItemService } from './context/context-item.service';
import { ElectronContextImagePicker } from './context/image-context-picker';
import { ProjectRulesService } from './context/project-rules.service';
import { ConversationRepository } from './conversations/conversation.repository';
import { ConversationService } from './conversations/conversation.service';
import { CrashReportService, type RecordCrashReportInput } from './crash/crash-report.service';
import { createAppDatabase, type AppDatabase } from './database/database';
import { WorkspaceFileService } from './filesystem/workspace-file.service';
import { WorkspaceWatchService } from './filesystem/workspace-watch.service';
import { GitService } from './git/git.service';
import { registerFilesIpc, unregisterFilesIpc } from './ipc/files.ipc';
import { registerAuditIpc, unregisterAuditIpc } from './ipc/audit.ipc';
import { registerGitIpc, unregisterGitIpc } from './ipc/git.ipc';
import { registerHealthIpc, unregisterHealthIpc } from './ipc/health.ipc';
import { ChatIpcController, registerChatIpc, unregisterChatIpc } from './ipc/chat.ipc';
import { registerChangesIpc, unregisterChangesIpc } from './ipc/changes.ipc';
import { registerCommandsIpc, unregisterCommandsIpc } from './ipc/commands.ipc';
import { registerContextIpc, unregisterContextIpc } from './ipc/context.ipc';
import { registerConversationsIpc, unregisterConversationsIpc } from './ipc/conversations.ipc';
import { registerCrashReportsIpc, unregisterCrashReportsIpc } from './ipc/crash-reports.ipc';
import { registerProvidersIpc, unregisterProvidersIpc } from './ipc/providers.ipc';
import { registerSettingsIpc, unregisterSettingsIpc } from './ipc/settings.ipc';
import { registerWorkspaceIpc, unregisterWorkspaceIpc } from './ipc/workspace.ipc';
import { registerTerminalIpc, unregisterTerminalIpc } from './ipc/terminal.ipc';
import { registerUpdatesIpc, unregisterUpdatesIpc } from './ipc/updates.ipc';
import { ProviderConfigRepository } from './providers/provider-config.repository';
import { ModelConfigRepository } from './providers/model-config.repository';
import { ProviderService } from './providers/provider.service';
import { registerModelProviders } from './providers/register-model-providers';
import { SecretRepository } from './security/secret.repository';
import { ElectronSafeStorageCryptography, SecureSecretStore } from './security/secret-store';
import { AppSettingsRepository } from './settings/app-settings.repository';
import { AppSettingsService } from './settings/app-settings.service';
import { ProposalAwarePermissionPolicy } from './tools/file-proposal-tools';
import { createAgentToolRegistry } from './tools/register-read-only-tools';
import { createMainWindow, resolvePreloadPath } from './window/create-main-window';
import { ElectronDirectoryPicker } from './workspace/directory-picker';
import { WorkspaceRepository } from './workspace/workspace.repository';
import { WorkspaceService } from './workspace/workspace.service';
import { TerminalSessionService } from './terminal/terminal-session.service';
import { UpdateService } from './updates/update.service';

const rendererHtmlPath = join(__dirname, '../renderer/index.html');
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const { autoUpdater } = electronUpdater;
let database: AppDatabase | null = null;
let workspaceWatcher: WorkspaceWatchService | null = null;
let chatIpcController: ChatIpcController | null = null;
let commandService: CommandService | null = null;
let terminalService: TerminalSessionService | null = null;
let crashReportService: CrashReportService | null = null;
let updateService: UpdateService | null = null;
let startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function recordCrashSafely(input: RecordCrashReportInput): void {
  try {
    crashReportService?.record(input);
  } catch {
    // Crash reporting must never recursively fail the process it is observing.
  }
}

async function openMainWindow(): Promise<void> {
  await createMainWindow({
    preloadPath: resolvePreloadPath(__dirname),
    rendererHtmlPath,
    ...(devServerUrl === undefined ? {} : { devServerUrl }),
    onRendererGone: (details) => {
      recordCrashSafely({
        processType: 'renderer',
        reason: details.reason,
        exitCode: details.exitCode,
      });
      return (
        details.reason !== 'clean-exit' && crashReportService?.shouldRecoverRenderer() === true
      );
    },
  });
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  recordCrashSafely({
    processType: 'main',
    reason: 'uncaught_exception',
    details: {
      name: error.name,
      message: error.message,
      origin,
    },
  });
});

process.on('unhandledRejection', (reason) => {
  recordCrashSafely({
    processType: 'main',
    reason: 'unhandled_rejection',
    details: {
      message: reason instanceof Error ? reason.message : String(reason),
    },
  });
});

app.on('child-process-gone', (_event, details) => {
  recordCrashSafely({
    processType: 'child',
    reason: details.reason,
    exitCode: details.exitCode,
    details: {
      type: details.type,
      ...(details.name === undefined ? {} : { name: details.name }),
      ...(details.serviceName === undefined ? {} : { serviceName: details.serviceName }),
    },
  });
});

void app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId('dev.opencode.desk');

    const trustedRendererOptions = {
      rendererHtmlPath,
      ...(devServerUrl === undefined ? {} : { devServerUrl }),
    };

    database = createAppDatabase(join(app.getPath('userData'), 'open-code-desk.sqlite'));
    const auditLog = new AuditLogService(database);
    const workspaceRepository = new WorkspaceRepository(database);
    const workspaceService = new WorkspaceService(
      workspaceRepository,
      new ElectronDirectoryPicker(),
    );
    const fileService = new WorkspaceFileService(workspaceService, auditLog);
    const gitService = new GitService(workspaceService);
    terminalService = new TerminalSessionService(workspaceService);
    workspaceWatcher = new WorkspaceWatchService();
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
    const settingsService = new AppSettingsService(
      new AppSettingsRepository(database),
      providerConfigRepository,
    );
    const initialSettings = settingsService.get();
    nativeTheme.themeSource = initialSettings.theme;
    crashReportService = new CrashReportService(
      database,
      app.getVersion(),
      initialSettings.crashReporting,
    );
    crashReportService.startNativeReporter(crashReporter);
    updateService = new UpdateService(autoUpdater, app.isPackaged, app.getVersion(), (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(updateChannels.statusChanged, status);
      }
    });
    const conversationRepository = new ConversationRepository(database);
    const contextItemRepository = new ContextItemRepository(database);
    const agentTaskRepository = new AgentTaskRepository(database);
    const toolCallRepository = new ToolCallRepository(database, auditLog);
    const commandRepository = new CommandRepository(database);
    const changeRepository = new FileChangeRepository(database);
    const changeArtifacts = new ChangeArtifactStore(
      join(app.getPath('userData'), 'change-artifacts'),
    );
    await changeArtifacts.initialize();
    const changePaths = new ChangePathResolver(workspaceService);
    const changeService = new FileChangeService(
      changeRepository,
      changeArtifacts,
      changePaths,
      agentTaskRepository,
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
    commandService = new CommandService(
      commandRepository,
      new PermissionRuleRepository(database),
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
      createAgentToolRegistry(fileService, changeService, commandService, gitService),
      toolCallRepository,
      changeService,
      new ProposalAwarePermissionPolicy(),
      commandService,
      contextItemRepository,
      new ProjectRulesService(fileService),
    );
    chatIpcController = new ChatIpcController(agentService);

    registerHealthIpc({
      version: app.getVersion(),
      ...trustedRendererOptions,
    });
    registerAuditIpc(trustedRendererOptions, auditLog);
    registerWorkspaceIpc(trustedRendererOptions, workspaceService, (workspace) => {
      workspaceWatcher?.start(workspace);
    });
    registerFilesIpc(trustedRendererOptions, fileService);
    registerGitIpc(trustedRendererOptions, gitService);
    registerProvidersIpc(trustedRendererOptions, providerService);
    registerSettingsIpc(trustedRendererOptions, settingsService, (settings) => {
      nativeTheme.themeSource = settings.theme;
      crashReportService?.setEnabled(settings.crashReporting, crashReporter);
    });
    registerConversationsIpc(trustedRendererOptions, conversationService);
    registerCrashReportsIpc(trustedRendererOptions, crashReportService);
    registerUpdatesIpc(trustedRendererOptions, updateService);
    registerContextIpc(
      trustedRendererOptions,
      new ContextItemService(
        contextItemRepository,
        conversationRepository,
        new ElectronContextImagePicker(),
      ),
    );
    registerChangesIpc(trustedRendererOptions, changeService, changeTransactions);
    registerCommandsIpc(trustedRendererOptions, commandService);
    registerTerminalIpc(trustedRendererOptions, terminalService);
    registerChatIpc(trustedRendererOptions, chatIpcController);

    await openMainWindow();
    if (initialSettings.autoCheckUpdates) {
      startupUpdateTimer = setTimeout(() => {
        void updateService?.check();
        startupUpdateTimer = null;
      }, 3_000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void openMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    const message = redactAuditText(
      error instanceof Error ? error.message : '应用初始化过程中发生未知错误。',
    ).slice(0, 1_000);
    recordCrashSafely({
      processType: 'main',
      reason: 'startup_failed',
      details: { message },
    });
    dialog.showErrorBox(
      'OpenCode Desk 启动失败',
      `应用无法完成初始化。\n\n${message}\n\n请重启应用；若问题持续，请查看本地崩溃报告。`,
    );
    app.exit(1);
  });

app.on('before-quit', () => {
  if (chatIpcController !== null) {
    unregisterChatIpc(chatIpcController);
    chatIpcController = null;
  }
  unregisterConversationsIpc();
  unregisterCrashReportsIpc();
  unregisterUpdatesIpc();
  unregisterAuditIpc();
  unregisterContextIpc();
  unregisterChangesIpc();
  unregisterCommandsIpc();
  unregisterTerminalIpc();
  unregisterProvidersIpc();
  unregisterSettingsIpc();
  unregisterGitIpc();
  unregisterFilesIpc();
  unregisterWorkspaceIpc();
  unregisterHealthIpc();
  workspaceWatcher?.close();
  workspaceWatcher = null;
  commandService?.close();
  commandService = null;
  terminalService?.closeAll();
  terminalService = null;
  crashReportService = null;
  if (startupUpdateTimer !== null) {
    clearTimeout(startupUpdateTimer);
    startupUpdateTimer = null;
  }
  updateService = null;
  database?.close();
  database = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
