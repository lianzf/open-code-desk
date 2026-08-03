import { contextBridge } from 'electron';

import type { DesktopApi } from '@open-code-desk/ipc-contracts';

import { auditApi, appApi, filesApi, providersApi, workspaceApi } from './api/core-api';
import { debugApi } from './api/debug-api';
import {
  chatApi,
  changesApi,
  conversationsApi,
  crashReportsApi,
  settingsApi,
} from './api/session-api';
import { projectTasksApi, runApi } from './api/run-api';
import { commandsApi, contextApi, permissionsApi, terminalApi } from './api/tooling-api';
import { gitApi, updatesApi } from './api/system-api';

const desktopApi: DesktopApi = {
  audit: auditApi,
  app: appApi,
  workspace: workspaceApi,
  files: filesApi,
  providers: providersApi,
  run: runApi,
  projectTasks: projectTasksApi,
  debug: debugApi,
  settings: settingsApi,
  conversations: conversationsApi,
  crashReports: crashReportsApi,
  chat: chatApi,
  changes: changesApi,
  commands: commandsApi,
  permissions: permissionsApi,
  context: contextApi,
  terminal: terminalApi,
  updates: updatesApi,
  git: gitApi,
};

contextBridge.exposeInMainWorld('openCodeDesk', desktopApi);
