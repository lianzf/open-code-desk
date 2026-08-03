import { app, crashReporter, nativeTheme } from 'electron';

import { registerAuditIpc, unregisterAuditIpc } from '../ipc/audit.ipc';
import { registerChangesIpc, unregisterChangesIpc } from '../ipc/changes.ipc';
import { registerChatIpc, unregisterChatIpc } from '../ipc/chat.ipc';
import { registerCommandsIpc, unregisterCommandsIpc } from '../ipc/commands.ipc';
import { registerContextIpc, unregisterContextIpc } from '../ipc/context.ipc';
import { registerConversationsIpc, unregisterConversationsIpc } from '../ipc/conversations.ipc';
import { registerCrashReportsIpc, unregisterCrashReportsIpc } from '../ipc/crash-reports.ipc';
import { registerDebugContextIpc, unregisterDebugContextIpc } from '../ipc/debug-context.ipc';
import { registerDebugIpc, unregisterDebugIpc } from '../ipc/debug.ipc';
import { registerFilesIpc, unregisterFilesIpc } from '../ipc/files.ipc';
import { registerGitIpc, unregisterGitIpc } from '../ipc/git.ipc';
import { registerHealthIpc, unregisterHealthIpc } from '../ipc/health.ipc';
import { registerPermissionsIpc, unregisterPermissionsIpc } from '../ipc/permissions.ipc';
import { registerProjectTasksIpc, unregisterProjectTasksIpc } from '../ipc/project-tasks.ipc';
import { registerProvidersIpc, unregisterProvidersIpc } from '../ipc/providers.ipc';
import { registerRunIpc, unregisterRunIpc } from '../ipc/run.ipc';
import { registerSettingsIpc, unregisterSettingsIpc } from '../ipc/settings.ipc';
import { registerTerminalIpc, unregisterTerminalIpc } from '../ipc/terminal.ipc';
import { registerUpdatesIpc, unregisterUpdatesIpc } from '../ipc/updates.ipc';
import { registerWorkspaceIpc, unregisterWorkspaceIpc } from '../ipc/workspace.ipc';
import type { TrustedRendererOptions } from '../ipc/assert-trusted-event';
import type { ApplicationServices } from './application-services';

export function registerApplicationIpc(
  options: TrustedRendererOptions,
  services: ApplicationServices,
): void {
  registerHealthIpc({ version: app.getVersion(), ...options });
  registerAuditIpc(options, services.auditLog);
  registerWorkspaceIpc(options, services.workspaceService, (workspace) => {
    services.workspaceWatcher.start(workspace);
  });
  registerFilesIpc(options, services.fileService);
  registerGitIpc(options, services.gitService);
  registerProvidersIpc(options, services.providerService);
  registerRunIpc(
    options,
    services.workspaceService,
    services.runConfigurationService,
    services.runExecutionService,
    services.compoundRunService,
  );
  registerProjectTasksIpc(
    options,
    services.workspaceService,
    services.projectTaskService,
    services.projectTaskExecutionService,
  );
  registerDebugIpc(options, services.debugSessionService);
  registerDebugContextIpc(options, services.debugContextService);
  registerSettingsIpc(options, services.settingsService, (settings) => {
    nativeTheme.themeSource = settings.theme;
    services.crashReportService.setEnabled(settings.crashReporting, crashReporter);
  });
  registerConversationsIpc(options, services.conversationService);
  registerCrashReportsIpc(options, services.crashReportService);
  registerUpdatesIpc(options, services.updateService);
  registerContextIpc(options, services.contextItemService);
  registerChangesIpc(options, services.changeService, services.changeTransactions);
  registerCommandsIpc(options, services.commandService);
  registerPermissionsIpc(options, services.permissionService, services.toolApprovalService);
  registerTerminalIpc(options, services.terminalService);
  registerChatIpc(options, services.chatIpcController);
}

export function unregisterApplicationIpc(services: ApplicationServices): void {
  unregisterChatIpc(services.chatIpcController);
  unregisterConversationsIpc();
  unregisterCrashReportsIpc();
  unregisterUpdatesIpc();
  unregisterAuditIpc();
  unregisterContextIpc();
  unregisterChangesIpc();
  unregisterCommandsIpc();
  unregisterPermissionsIpc();
  unregisterTerminalIpc();
  unregisterProvidersIpc();
  unregisterDebugContextIpc();
  unregisterDebugIpc();
  unregisterProjectTasksIpc();
  unregisterRunIpc();
  unregisterSettingsIpc();
  unregisterGitIpc();
  unregisterFilesIpc();
  unregisterWorkspaceIpc();
  unregisterHealthIpc();
}
