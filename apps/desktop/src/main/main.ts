import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { AgentService } from './agent/agent.service';
import { AgentTaskRepository } from './agent/agent-task.repository';
import { ToolCallRepository } from './agent/tool-call.repository';
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
import { ConversationRepository } from './conversations/conversation.repository';
import { ConversationService } from './conversations/conversation.service';
import { createAppDatabase, type AppDatabase } from './database/database';
import { WorkspaceFileService } from './filesystem/workspace-file.service';
import { WorkspaceWatchService } from './filesystem/workspace-watch.service';
import { GitService } from './git/git.service';
import { registerFilesIpc, unregisterFilesIpc } from './ipc/files.ipc';
import { registerGitIpc, unregisterGitIpc } from './ipc/git.ipc';
import { registerHealthIpc, unregisterHealthIpc } from './ipc/health.ipc';
import { ChatIpcController, registerChatIpc, unregisterChatIpc } from './ipc/chat.ipc';
import { registerChangesIpc, unregisterChangesIpc } from './ipc/changes.ipc';
import { registerCommandsIpc, unregisterCommandsIpc } from './ipc/commands.ipc';
import { registerContextIpc, unregisterContextIpc } from './ipc/context.ipc';
import { registerConversationsIpc, unregisterConversationsIpc } from './ipc/conversations.ipc';
import { registerProvidersIpc, unregisterProvidersIpc } from './ipc/providers.ipc';
import { registerWorkspaceIpc, unregisterWorkspaceIpc } from './ipc/workspace.ipc';
import { registerTerminalIpc, unregisterTerminalIpc } from './ipc/terminal.ipc';
import { OpenAICompatibleProvider } from './providers/openai-compatible/openai-compatible.provider';
import { ProviderConfigRepository } from './providers/provider-config.repository';
import { ProviderService } from './providers/provider.service';
import { SecretRepository } from './security/secret.repository';
import { ElectronSafeStorageCryptography, SecureSecretStore } from './security/secret-store';
import { ProposalAwarePermissionPolicy } from './tools/file-proposal-tools';
import { createAgentToolRegistry } from './tools/register-read-only-tools';
import { createMainWindow, resolvePreloadPath } from './window/create-main-window';
import { ElectronDirectoryPicker } from './workspace/directory-picker';
import { WorkspaceRepository } from './workspace/workspace.repository';
import { WorkspaceService } from './workspace/workspace.service';
import { TerminalSessionService } from './terminal/terminal-session.service';

const rendererHtmlPath = join(__dirname, '../renderer/index.html');
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
let database: AppDatabase | null = null;
let workspaceWatcher: WorkspaceWatchService | null = null;
let chatIpcController: ChatIpcController | null = null;
let commandService: CommandService | null = null;
let terminalService: TerminalSessionService | null = null;

async function openMainWindow(): Promise<void> {
  await createMainWindow({
    preloadPath: resolvePreloadPath(__dirname),
    rendererHtmlPath,
    ...(devServerUrl === undefined ? {} : { devServerUrl }),
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.opencode.desk');

  const trustedRendererOptions = {
    rendererHtmlPath,
    ...(devServerUrl === undefined ? {} : { devServerUrl }),
  };

  database = createAppDatabase(join(app.getPath('userData'), 'open-code-desk.sqlite'));
  const workspaceRepository = new WorkspaceRepository(database);
  const workspaceService = new WorkspaceService(workspaceRepository, new ElectronDirectoryPicker());
  const fileService = new WorkspaceFileService(workspaceService);
  const gitService = new GitService(workspaceService);
  terminalService = new TerminalSessionService(workspaceService);
  workspaceWatcher = new WorkspaceWatchService();
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new OpenAICompatibleProvider());
  const secretStore = new SecureSecretStore(
    new SecretRepository(database),
    new ElectronSafeStorageCryptography(),
  );
  const providerService = new ProviderService(
    new ProviderConfigRepository(database),
    secretStore,
    providerRegistry,
  );
  const conversationRepository = new ConversationRepository(database);
  const contextItemRepository = new ContextItemRepository(database);
  const agentTaskRepository = new AgentTaskRepository(database);
  const toolCallRepository = new ToolCallRepository(database);
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
  );
  await changeTransactions.recoverInterrupted();
  commandRepository.recoverInterrupted();
  agentTaskRepository.recoverInterrupted();
  commandService = new CommandService(
    commandRepository,
    new PermissionRuleRepository(database),
    workspaceService,
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
  );
  chatIpcController = new ChatIpcController(agentService);

  registerHealthIpc({
    version: app.getVersion(),
    ...trustedRendererOptions,
  });
  registerWorkspaceIpc(trustedRendererOptions, workspaceService, (workspace) => {
    workspaceWatcher?.start(workspace);
  });
  registerFilesIpc(trustedRendererOptions, fileService);
  registerGitIpc(trustedRendererOptions, gitService);
  registerProvidersIpc(trustedRendererOptions, providerService);
  registerConversationsIpc(trustedRendererOptions, conversationService);
  registerContextIpc(
    trustedRendererOptions,
    new ContextItemService(contextItemRepository, conversationRepository),
  );
  registerChangesIpc(trustedRendererOptions, changeService, changeTransactions);
  registerCommandsIpc(trustedRendererOptions, commandService);
  registerTerminalIpc(trustedRendererOptions, terminalService);
  registerChatIpc(trustedRendererOptions, chatIpcController);

  await openMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void openMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (chatIpcController !== null) {
    unregisterChatIpc(chatIpcController);
    chatIpcController = null;
  }
  unregisterConversationsIpc();
  unregisterContextIpc();
  unregisterChangesIpc();
  unregisterCommandsIpc();
  unregisterTerminalIpc();
  unregisterProvidersIpc();
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
  database?.close();
  database = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
