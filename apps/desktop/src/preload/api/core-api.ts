import { ipcRenderer } from 'electron';

import {
  auditChannels,
  auditEventListSchema,
  cancelFileSearchRequestSchema,
  cancelFileSearchResponseSchema,
  connectionTestResultSchema,
  createDirectoryRequestSchema,
  createFileRequestSchema,
  deletePathRequestSchema,
  deleteProviderRequestSchema,
  deleteProviderResponseSchema,
  fileChangedEventSchema,
  fileEntryListSchema,
  fileMutationResponseSchema,
  filesChannels,
  healthRequestSchema,
  healthResponseSchema,
  ipcChannels,
  listAuditEventsRequestSchema,
  listDirectoryRequestSchema,
  modelInfoListSchema,
  movePathRequestSchema,
  nullableWorkspaceInfoSchema,
  openRecentWorkspaceRequestSchema,
  providerChannels,
  providerConfigListSchema,
  providerConfigSchema,
  providerDescriptorListSchema,
  providerIdRequestSchema,
  readFileRequestSchema,
  readFileResponseSchema,
  saveProviderRequestSchema,
  searchFilesRequestSchema,
  searchTextRequestSchema,
  textSearchResponseSchema,
  type DesktopApi,
  workspaceChannels,
  workspaceInfoListSchema,
  workspaceInfoSchema,
  writeFileRequestSchema,
  writeFileResponseSchema,
} from '@open-code-desk/ipc-contracts';

export const auditApi: DesktopApi['audit'] = {
  async list(input) {
    const request = listAuditEventsRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(auditChannels.list, request);
    return auditEventListSchema.parse(response);
  },
};

export const appApi: DesktopApi['app'] = {
  async health(input) {
    const request = healthRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(ipcChannels.healthCheck, request);
    return healthResponseSchema.parse(response);
  },
};

export const workspaceApi: DesktopApi['workspace'] = {
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
};

export const filesApi: DesktopApi['files'] = {
  onChanged(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(fileChangedEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(filesChannels.changed, wrappedListener);
    return () => ipcRenderer.removeListener(filesChannels.changed, wrappedListener);
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
};

export const providersApi: DesktopApi['providers'] = {
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
};
