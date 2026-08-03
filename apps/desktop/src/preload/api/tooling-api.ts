import { ipcRenderer } from 'electron';

import {
  addBlockedPathRequestSchema,
  commandActionResponseSchema,
  commandChannels,
  commandExecutionListSchema,
  commandExecutionSchema,
  commandIdRequestSchema,
  contextChannels,
  contextConversationRequestSchema,
  conversationContextItemSchema,
  conversationContextListSchema,
  createTerminalRequestSchema,
  decideCommandRequestSchema,
  decideToolApprovalRequestSchema,
  deleteConversationContextRequestSchema,
  deleteConversationContextResponseSchema,
  deletePermissionRuleRequestSchema,
  deletePermissionRuleResponseSchema,
  grantExternalDirectoryRequestSchema,
  listCommandsRequestSchema,
  nullablePermissionRuleSchema,
  permissionActionResponseSchema,
  permissionChannels,
  permissionRuleListSchema,
  permissionRuleSchema,
  pickConversationImageResponseSchema,
  saveConversationContextRequestSchema,
  setNetworkAccessRequestSchema,
  setReadAutoAllowRequestSchema,
  terminalActionResponseSchema,
  terminalChannels,
  terminalDataEventSchema,
  terminalExitEventSchema,
  terminalResizeRequestSchema,
  terminalSessionInfoSchema,
  terminalSessionRequestSchema,
  terminalWriteRequestSchema,
  type DesktopApi,
  upsertExecutableRuleRequestSchema,
  workspaceRulesRequestSchema,
} from '@open-code-desk/ipc-contracts';

export const commandsApi: DesktopApi['commands'] = {
  async listForConversation(input) {
    const request = listCommandsRequestSchema.parse(input);
    return commandExecutionListSchema.parse(
      await ipcRenderer.invoke(commandChannels.listForConversation, request),
    );
  },
  async decide(input) {
    const request = decideCommandRequestSchema.parse(input);
    return commandExecutionSchema.parse(await ipcRenderer.invoke(commandChannels.decide, request));
  },
  async cancel(input) {
    const request = commandIdRequestSchema.parse(input);
    return commandActionResponseSchema.parse(
      await ipcRenderer.invoke(commandChannels.cancel, request),
    );
  },
  async listRules(input) {
    const request = workspaceRulesRequestSchema.parse(input);
    return permissionRuleListSchema.parse(
      await ipcRenderer.invoke(commandChannels.listRules, request),
    );
  },
  async deleteRule(input) {
    const request = deletePermissionRuleRequestSchema.parse(input);
    return deletePermissionRuleResponseSchema.parse(
      await ipcRenderer.invoke(commandChannels.deleteRule, request),
    );
  },
  async setNetworkAccess(input) {
    const request = setNetworkAccessRequestSchema.parse(input);
    return permissionRuleListSchema.parse(
      await ipcRenderer.invoke(commandChannels.setNetworkAccess, request),
    );
  },
  async upsertExecutableRule(input) {
    const request = upsertExecutableRuleRequestSchema.parse(input);
    return permissionRuleSchema.parse(
      await ipcRenderer.invoke(commandChannels.upsertExecutableRule, request),
    );
  },
};

export const permissionsApi: DesktopApi['permissions'] = {
  async addBlockedPath(input) {
    const request = addBlockedPathRequestSchema.parse(input);
    return permissionRuleSchema.parse(
      await ipcRenderer.invoke(permissionChannels.addBlockedPath, request),
    );
  },
  async decideTool(input) {
    const request = decideToolApprovalRequestSchema.parse(input);
    return permissionActionResponseSchema.parse(
      await ipcRenderer.invoke(permissionChannels.decideTool, request),
    );
  },
  async deleteRule(input) {
    const request = deletePermissionRuleRequestSchema.parse(input);
    return deletePermissionRuleResponseSchema.parse(
      await ipcRenderer.invoke(permissionChannels.deleteRule, request),
    );
  },
  async grantExternalDirectory(input) {
    const request = grantExternalDirectoryRequestSchema.parse(input);
    return nullablePermissionRuleSchema.parse(
      await ipcRenderer.invoke(permissionChannels.grantExternalDirectory, request),
    );
  },
  async listRules(input) {
    const request = workspaceRulesRequestSchema.parse(input);
    return permissionRuleListSchema.parse(
      await ipcRenderer.invoke(permissionChannels.listRules, request),
    );
  },
  async setReadAutoAllow(input) {
    const request = setReadAutoAllowRequestSchema.parse(input);
    return permissionRuleListSchema.parse(
      await ipcRenderer.invoke(permissionChannels.setReadAutoAllow, request),
    );
  },
};

export const contextApi: DesktopApi['context'] = {
  async list(input) {
    const request = contextConversationRequestSchema.parse(input);
    return conversationContextListSchema.parse(
      await ipcRenderer.invoke(contextChannels.list, request),
    );
  },
  async pickImage(input) {
    const request = contextConversationRequestSchema.parse(input);
    return pickConversationImageResponseSchema.parse(
      await ipcRenderer.invoke(contextChannels.pickImage, request),
    );
  },
  async save(input) {
    const request = saveConversationContextRequestSchema.parse(input);
    return conversationContextItemSchema.parse(
      await ipcRenderer.invoke(contextChannels.save, request),
    );
  },
  async delete(input) {
    const request = deleteConversationContextRequestSchema.parse(input);
    return deleteConversationContextResponseSchema.parse(
      await ipcRenderer.invoke(contextChannels.delete, request),
    );
  },
};

export const terminalApi: DesktopApi['terminal'] = {
  async create(input) {
    const request = createTerminalRequestSchema.parse(input);
    return terminalSessionInfoSchema.parse(
      await ipcRenderer.invoke(terminalChannels.create, request),
    );
  },
  async write(input) {
    const request = terminalWriteRequestSchema.parse(input);
    return terminalActionResponseSchema.parse(
      await ipcRenderer.invoke(terminalChannels.write, request),
    );
  },
  async resize(input) {
    const request = terminalResizeRequestSchema.parse(input);
    return terminalActionResponseSchema.parse(
      await ipcRenderer.invoke(terminalChannels.resize, request),
    );
  },
  async close(input) {
    const request = terminalSessionRequestSchema.parse(input);
    return terminalActionResponseSchema.parse(
      await ipcRenderer.invoke(terminalChannels.close, request),
    );
  },
  onData(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(terminalDataEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(terminalChannels.data, wrappedListener);
    return () => ipcRenderer.removeListener(terminalChannels.data, wrappedListener);
  },
  onExit(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(terminalExitEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(terminalChannels.exit, wrappedListener);
    return () => ipcRenderer.removeListener(terminalChannels.exit, wrappedListener);
  },
};
