import { contextBridge, ipcRenderer } from 'electron';
import {
  applyChangeSetRequestSchema,
  addBlockedPathRequestSchema,
  auditChannels,
  auditEventListSchema,
  cancelChatRequestSchema,
  cancelChatResponseSchema,
  cancelFileSearchRequestSchema,
  cancelFileSearchResponseSchema,
  commandActionResponseSchema,
  commandChannels,
  commandExecutionListSchema,
  commandExecutionSchema,
  commandIdRequestSchema,
  contextChannels,
  contextConversationRequestSchema,
  conversationContextItemSchema,
  conversationContextListSchema,
  changeContentsRequestSchema,
  changeContentsSchema,
  changesChannels,
  changeSetIdRequestSchema,
  chatChannels,
  chatStreamEventSchema,
  connectionTestResultSchema,
  conversationDetailSchema,
  conversationIdRequestSchema,
  conversationListSchema,
  conversationSchema,
  conversationsChannels,
  crashReportChannels,
  crashReportListSchema,
  createDirectoryRequestSchema,
  createFileRequestSchema,
  createConversationRequestSchema,
  deleteProviderRequestSchema,
  deleteProviderResponseSchema,
  deletePathRequestSchema,
  decideCommandRequestSchema,
  decideToolApprovalRequestSchema,
  deletePermissionRuleRequestSchema,
  deletePermissionRuleResponseSchema,
  deleteConversationContextRequestSchema,
  deleteConversationContextResponseSchema,
  editChangeProposalRequestSchema,
  fileChangedEventSchema,
  fileEntryListSchema,
  fileMutationResponseSchema,
  fileChangeSetListSchema,
  fileChangeSetSchema,
  filesChannels,
  healthRequestSchema,
  healthResponseSchema,
  grantExternalDirectoryRequestSchema,
  gitChannels,
  gitDiffRequestSchema,
  gitDiffSchema,
  gitStatusRequestSchema,
  gitStatusSchema,
  ipcChannels,
  listDirectoryRequestSchema,
  listAuditEventsRequestSchema,
  listConversationsRequestSchema,
  listChangeSetsRequestSchema,
  listCommandsRequestSchema,
  listCrashReportsRequestSchema,
  modelInfoListSchema,
  movePathRequestSchema,
  nullableWorkspaceInfoSchema,
  nullablePermissionRuleSchema,
  openRecentWorkspaceRequestSchema,
  providerChannels,
  providerConfigListSchema,
  providerConfigSchema,
  providerDescriptorListSchema,
  providerIdRequestSchema,
  projectDetectionSchema,
  permissionRuleListSchema,
  permissionRuleSchema,
  permissionActionResponseSchema,
  permissionChannels,
  pickConversationImageResponseSchema,
  readFileRequestSchema,
  readFileResponseSchema,
  reviewChangeRequestSchema,
  reviewManyChangesRequestSchema,
  renameConversationRequestSchema,
  searchFilesRequestSchema,
  searchTextRequestSchema,
  textSearchResponseSchema,
  saveProviderRequestSchema,
  saveRunConfigurationRequestSchema,
  saveConversationContextRequestSchema,
  settingsChannels,
  setDefaultRunConfigurationRequestSchema,
  setDefaultRunConfigurationResponseSchema,
  appSettingsSchema,
  updateAppSettingsRequestSchema,
  updateActionRequestSchema,
  updateChannels,
  updateStatusSchema,
  setNetworkAccessRequestSchema,
  setReadAutoAllowRequestSchema,
  upsertExecutableRuleRequestSchema,
  installUpdateResponseSchema,
  startChatRequestSchema,
  startChatResponseSchema,
  deleteRunConfigurationRequestSchema,
  deleteRunConfigurationResponseSchema,
  detectProjectRequestSchema,
  listRunConfigurationsRequestSchema,
  runChannels,
  runConfigurationListSchema,
  runConfigurationSchema,
  deleteConversationResponseSchema,
  exportConversationResponseSchema,
  type DesktopApi,
  terminalActionResponseSchema,
  terminalChannels,
  terminalDataEventSchema,
  terminalExitEventSchema,
  terminalResizeRequestSchema,
  terminalSessionInfoSchema,
  terminalSessionRequestSchema,
  terminalWriteRequestSchema,
  createTerminalRequestSchema,
  acknowledgeCrashReportRequestSchema,
  acknowledgeCrashReportResponseSchema,
  workspaceChannels,
  workspaceRulesRequestSchema,
  workspaceInfoListSchema,
  workspaceInfoSchema,
  writeFileRequestSchema,
  writeFileResponseSchema,
} from '@open-code-desk/ipc-contracts';

const desktopApi: DesktopApi = {
  audit: {
    async list(input) {
      const request = listAuditEventsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(auditChannels.list, request);
      return auditEventListSchema.parse(response);
    },
  },
  app: {
    async health(input) {
      const request = healthRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(ipcChannels.healthCheck, request);
      return healthResponseSchema.parse(response);
    },
  },
  workspace: {
    async getCurrent() {
      const response: unknown = await ipcRenderer.invoke(workspaceChannels.getCurrent);
      return nullableWorkspaceInfoSchema.parse(response);
    },
    async listRecent() {
      const response: unknown = await ipcRenderer.invoke(workspaceChannels.listRecent);
      return workspaceInfoListSchema.parse(response);
    },
    async openDialog() {
      const response: unknown = await ipcRenderer.invoke(workspaceChannels.openDialog);
      return nullableWorkspaceInfoSchema.parse(response);
    },
    async openRecent(input) {
      const request = openRecentWorkspaceRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(workspaceChannels.openRecent, request);
      return workspaceInfoSchema.parse(response);
    },
  },
  files: {
    onChanged(listener) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
        listener(fileChangedEventSchema.parse(untrustedEvent));
      };
      ipcRenderer.on(filesChannels.changed, wrappedListener);
      return () => {
        ipcRenderer.removeListener(filesChannels.changed, wrappedListener);
      };
    },
    async cancelSearch(input) {
      const request = cancelFileSearchRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.cancelSearch, request);
      return cancelFileSearchResponseSchema.parse(response);
    },
    async createDirectory(input) {
      const request = createDirectoryRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.createDirectory, request);
      return fileMutationResponseSchema.parse(response);
    },
    async createFile(input) {
      const request = createFileRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.createFile, request);
      return fileMutationResponseSchema.parse(response);
    },
    async deletePath(input) {
      const request = deletePathRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.deletePath, request);
      return fileMutationResponseSchema.parse(response);
    },
    async listDirectory(input) {
      const request = listDirectoryRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.listDirectory, request);
      return fileEntryListSchema.parse(response);
    },
    async movePath(input) {
      const request = movePathRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.movePath, request);
      return fileMutationResponseSchema.parse(response);
    },
    async readFile(input) {
      const request = readFileRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.readFile, request);
      return readFileResponseSchema.parse(response);
    },
    async searchFiles(input) {
      const request = searchFilesRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.searchFiles, request);
      return fileEntryListSchema.parse(response);
    },
    async searchText(input) {
      const request = searchTextRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.searchText, request);
      return textSearchResponseSchema.parse(response);
    },
    async writeFile(input) {
      const request = writeFileRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(filesChannels.writeFile, request);
      return writeFileResponseSchema.parse(response);
    },
  },
  providers: {
    async list() {
      const response: unknown = await ipcRenderer.invoke(providerChannels.list);
      return providerConfigListSchema.parse(response);
    },
    async listKinds() {
      const response: unknown = await ipcRenderer.invoke(providerChannels.listKinds);
      return providerDescriptorListSchema.parse(response);
    },
    async save(input) {
      const request = saveProviderRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(providerChannels.save, request);
      return providerConfigSchema.parse(response);
    },
    async delete(input) {
      const request = deleteProviderRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(providerChannels.delete, request);
      return deleteProviderResponseSchema.parse(response);
    },
    async testConnection(input) {
      const request = providerIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(providerChannels.testConnection, request);
      return connectionTestResultSchema.parse(response);
    },
    async listModels(input) {
      const request = providerIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(providerChannels.listModels, request);
      return modelInfoListSchema.parse(response);
    },
  },
  run: {
    async detect(input) {
      const request = detectProjectRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(runChannels.detectProject, request);
      return projectDetectionSchema.parse(response);
    },
    async list(input) {
      const request = listRunConfigurationsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(runChannels.listConfigurations, request);
      return runConfigurationListSchema.parse(response);
    },
    async save(input) {
      const request = saveRunConfigurationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(runChannels.saveConfiguration, request);
      return runConfigurationSchema.parse(response);
    },
    async delete(input) {
      const request = deleteRunConfigurationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(runChannels.deleteConfiguration, request);
      return deleteRunConfigurationResponseSchema.parse(response);
    },
    async setDefault(input) {
      const request = setDefaultRunConfigurationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        runChannels.setDefaultConfiguration,
        request,
      );
      return setDefaultRunConfigurationResponseSchema.parse(response);
    },
  },
  settings: {
    async get() {
      const response: unknown = await ipcRenderer.invoke(settingsChannels.get);
      return appSettingsSchema.parse(response);
    },
    async update(input) {
      const request = updateAppSettingsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(settingsChannels.update, request);
      return appSettingsSchema.parse(response);
    },
  },
  conversations: {
    async list(input) {
      const request = listConversationsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(conversationsChannels.list, request);
      return conversationListSchema.parse(response);
    },
    async create(input) {
      const request = createConversationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(conversationsChannels.create, request);
      return conversationSchema.parse(response);
    },
    async get(input) {
      const request = conversationIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(conversationsChannels.get, request);
      return conversationDetailSchema.parse(response);
    },
    async rename(input) {
      const request = renameConversationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(conversationsChannels.rename, request);
      return conversationSchema.parse(response);
    },
    async delete(input) {
      const request = conversationIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(conversationsChannels.delete, request);
      return deleteConversationResponseSchema.parse(response);
    },
    async exportMarkdown(input) {
      const request = conversationIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        conversationsChannels.exportMarkdown,
        request,
      );
      return exportConversationResponseSchema.parse(response);
    },
  },
  crashReports: {
    async list(input) {
      const request = listCrashReportsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(crashReportChannels.list, request);
      return crashReportListSchema.parse(response);
    },
    async acknowledge(input) {
      const request = acknowledgeCrashReportRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(crashReportChannels.acknowledge, request);
      return acknowledgeCrashReportResponseSchema.parse(response);
    },
  },
  chat: {
    async start(input) {
      const request = startChatRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(chatChannels.start, request);
      return startChatResponseSchema.parse(response);
    },
    async cancel(input) {
      const request = cancelChatRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(chatChannels.cancel, request);
      return cancelChatResponseSchema.parse(response);
    },
    onStreamEvent(listener) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
        listener(chatStreamEventSchema.parse(untrustedEvent));
      };
      ipcRenderer.on(chatChannels.streamEvent, wrappedListener);
      return () => {
        ipcRenderer.removeListener(chatChannels.streamEvent, wrappedListener);
      };
    },
  },
  changes: {
    async listForConversation(input) {
      const request = listChangeSetsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        changesChannels.listForConversation,
        request,
      );
      return fileChangeSetListSchema.parse(response);
    },
    async get(input) {
      const request = changeSetIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.get, request);
      return fileChangeSetSchema.parse(response);
    },
    async getContents(input) {
      const request = changeContentsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.getContents, request);
      return changeContentsSchema.parse(response);
    },
    async review(input) {
      const request = reviewChangeRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.review, request);
      return fileChangeSetSchema.parse(response);
    },
    async reviewMany(input) {
      const request = reviewManyChangesRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.reviewMany, request);
      return fileChangeSetSchema.parse(response);
    },
    async editProposal(input) {
      const request = editChangeProposalRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.editProposal, request);
      return fileChangeSetSchema.parse(response);
    },
    async apply(input) {
      const request = applyChangeSetRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.apply, request);
      return fileChangeSetSchema.parse(response);
    },
    async rollback(input) {
      const request = applyChangeSetRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(changesChannels.rollback, request);
      return fileChangeSetSchema.parse(response);
    },
  },
  commands: {
    async listForConversation(input) {
      const request = listCommandsRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        commandChannels.listForConversation,
        request,
      );
      return commandExecutionListSchema.parse(response);
    },
    async decide(input) {
      const request = decideCommandRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(commandChannels.decide, request);
      return commandExecutionSchema.parse(response);
    },
    async cancel(input) {
      const request = commandIdRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(commandChannels.cancel, request);
      return commandActionResponseSchema.parse(response);
    },
    async listRules(input) {
      const request = workspaceRulesRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(commandChannels.listRules, request);
      return permissionRuleListSchema.parse(response);
    },
    async deleteRule(input) {
      const request = deletePermissionRuleRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(commandChannels.deleteRule, request);
      return deletePermissionRuleResponseSchema.parse(response);
    },
    async setNetworkAccess(input) {
      const request = setNetworkAccessRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(commandChannels.setNetworkAccess, request);
      return permissionRuleListSchema.parse(response);
    },
    async upsertExecutableRule(input) {
      const request = upsertExecutableRuleRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        commandChannels.upsertExecutableRule,
        request,
      );
      return permissionRuleSchema.parse(response);
    },
  },
  permissions: {
    async addBlockedPath(input) {
      const request = addBlockedPathRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        permissionChannels.addBlockedPath,
        request,
      );
      return permissionRuleSchema.parse(response);
    },
    async decideTool(input) {
      const request = decideToolApprovalRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(permissionChannels.decideTool, request);
      return permissionActionResponseSchema.parse(response);
    },
    async deleteRule(input) {
      const request = deletePermissionRuleRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(permissionChannels.deleteRule, request);
      return deletePermissionRuleResponseSchema.parse(response);
    },
    async grantExternalDirectory(input) {
      const request = grantExternalDirectoryRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        permissionChannels.grantExternalDirectory,
        request,
      );
      return nullablePermissionRuleSchema.parse(response);
    },
    async listRules(input) {
      const request = workspaceRulesRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(permissionChannels.listRules, request);
      return permissionRuleListSchema.parse(response);
    },
    async setReadAutoAllow(input) {
      const request = setReadAutoAllowRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        permissionChannels.setReadAutoAllow,
        request,
      );
      return permissionRuleListSchema.parse(response);
    },
  },
  context: {
    async list(input) {
      const request = contextConversationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(contextChannels.list, request);
      return conversationContextListSchema.parse(response);
    },
    async pickImage(input) {
      const request = contextConversationRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(contextChannels.pickImage, request);
      return pickConversationImageResponseSchema.parse(response);
    },
    async save(input) {
      const request = saveConversationContextRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(contextChannels.save, request);
      return conversationContextItemSchema.parse(response);
    },
    async delete(input) {
      const request = deleteConversationContextRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(contextChannels.delete, request);
      return deleteConversationContextResponseSchema.parse(response);
    },
  },
  terminal: {
    async create(input) {
      const request = createTerminalRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(terminalChannels.create, request);
      return terminalSessionInfoSchema.parse(response);
    },
    async write(input) {
      const request = terminalWriteRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(terminalChannels.write, request);
      return terminalActionResponseSchema.parse(response);
    },
    async resize(input) {
      const request = terminalResizeRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(terminalChannels.resize, request);
      return terminalActionResponseSchema.parse(response);
    },
    async close(input) {
      const request = terminalSessionRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(terminalChannels.close, request);
      return terminalActionResponseSchema.parse(response);
    },
    onData(listener) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
        listener(terminalDataEventSchema.parse(untrustedEvent));
      };
      ipcRenderer.on(terminalChannels.data, wrappedListener);
      return () => {
        ipcRenderer.removeListener(terminalChannels.data, wrappedListener);
      };
    },
    onExit(listener) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
        listener(terminalExitEventSchema.parse(untrustedEvent));
      };
      ipcRenderer.on(terminalChannels.exit, wrappedListener);
      return () => {
        ipcRenderer.removeListener(terminalChannels.exit, wrappedListener);
      };
    },
  },
  updates: {
    async getStatus() {
      const request = updateActionRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(updateChannels.getStatus, request);
      return updateStatusSchema.parse(response);
    },
    async check() {
      const request = updateActionRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(updateChannels.check, request);
      return updateStatusSchema.parse(response);
    },
    async download() {
      const request = updateActionRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(updateChannels.download, request);
      return updateStatusSchema.parse(response);
    },
    async install() {
      const request = updateActionRequestSchema.parse({});
      const response: unknown = await ipcRenderer.invoke(updateChannels.install, request);
      return installUpdateResponseSchema.parse(response);
    },
    onStatusChanged(listener) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedStatus: unknown) => {
        listener(updateStatusSchema.parse(untrustedStatus));
      };
      ipcRenderer.on(updateChannels.statusChanged, wrappedListener);
      return () => ipcRenderer.removeListener(updateChannels.statusChanged, wrappedListener);
    },
  },
  git: {
    async status(input) {
      const request = gitStatusRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(gitChannels.status, request);
      return gitStatusSchema.parse(response);
    },
    async diff(input) {
      const request = gitDiffRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(gitChannels.diff, request);
      return gitDiffSchema.parse(response);
    },
  },
};

contextBridge.exposeInMainWorld('openCodeDesk', desktopApi);
