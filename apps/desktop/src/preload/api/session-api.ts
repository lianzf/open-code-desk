import { ipcRenderer } from 'electron';

import {
  acknowledgeCrashReportRequestSchema,
  acknowledgeCrashReportResponseSchema,
  appSettingsSchema,
  applyChangeSetRequestSchema,
  cancelChatRequestSchema,
  cancelChatResponseSchema,
  changeContentsRequestSchema,
  changeContentsSchema,
  changesChannels,
  changeSetIdRequestSchema,
  chatChannels,
  chatStreamEventSchema,
  conversationDetailSchema,
  conversationIdRequestSchema,
  conversationListSchema,
  conversationSchema,
  conversationsChannels,
  crashReportChannels,
  crashReportListSchema,
  createConversationRequestSchema,
  deleteConversationResponseSchema,
  editChangeProposalRequestSchema,
  exportConversationResponseSchema,
  fileChangeSetListSchema,
  fileChangeSetSchema,
  listChangeSetsRequestSchema,
  listConversationsRequestSchema,
  listCrashReportsRequestSchema,
  renameConversationRequestSchema,
  reviewChangeRequestSchema,
  reviewManyChangesRequestSchema,
  settingsChannels,
  startChatRequestSchema,
  startChatResponseSchema,
  type DesktopApi,
  updateAppSettingsRequestSchema,
} from '@open-code-desk/ipc-contracts';

export const settingsApi: DesktopApi['settings'] = {
  async get() {
    return appSettingsSchema.parse(await ipcRenderer.invoke(settingsChannels.get));
  },
  async update(input) {
    const request = updateAppSettingsRequestSchema.parse(input);
    return appSettingsSchema.parse(await ipcRenderer.invoke(settingsChannels.update, request));
  },
};

export const conversationsApi: DesktopApi['conversations'] = {
  async list(input) {
    const request = listConversationsRequestSchema.parse(input);
    return conversationListSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.list, request),
    );
  },
  async create(input) {
    const request = createConversationRequestSchema.parse(input);
    return conversationSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.create, request),
    );
  },
  async get(input) {
    const request = conversationIdRequestSchema.parse(input);
    return conversationDetailSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.get, request),
    );
  },
  async rename(input) {
    const request = renameConversationRequestSchema.parse(input);
    return conversationSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.rename, request),
    );
  },
  async delete(input) {
    const request = conversationIdRequestSchema.parse(input);
    return deleteConversationResponseSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.delete, request),
    );
  },
  async exportMarkdown(input) {
    const request = conversationIdRequestSchema.parse(input);
    return exportConversationResponseSchema.parse(
      await ipcRenderer.invoke(conversationsChannels.exportMarkdown, request),
    );
  },
};

export const crashReportsApi: DesktopApi['crashReports'] = {
  async list(input) {
    const request = listCrashReportsRequestSchema.parse(input);
    return crashReportListSchema.parse(await ipcRenderer.invoke(crashReportChannels.list, request));
  },
  async acknowledge(input) {
    const request = acknowledgeCrashReportRequestSchema.parse(input);
    return acknowledgeCrashReportResponseSchema.parse(
      await ipcRenderer.invoke(crashReportChannels.acknowledge, request),
    );
  },
};

export const chatApi: DesktopApi['chat'] = {
  async start(input) {
    const request = startChatRequestSchema.parse(input);
    return startChatResponseSchema.parse(await ipcRenderer.invoke(chatChannels.start, request));
  },
  async cancel(input) {
    const request = cancelChatRequestSchema.parse(input);
    return cancelChatResponseSchema.parse(await ipcRenderer.invoke(chatChannels.cancel, request));
  },
  onStreamEvent(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(chatStreamEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(chatChannels.streamEvent, wrappedListener);
    return () => ipcRenderer.removeListener(chatChannels.streamEvent, wrappedListener);
  },
};

export const changesApi: DesktopApi['changes'] = {
  async listForConversation(input) {
    const request = listChangeSetsRequestSchema.parse(input);
    return fileChangeSetListSchema.parse(
      await ipcRenderer.invoke(changesChannels.listForConversation, request),
    );
  },
  async get(input) {
    const request = changeSetIdRequestSchema.parse(input);
    return fileChangeSetSchema.parse(await ipcRenderer.invoke(changesChannels.get, request));
  },
  async getContents(input) {
    const request = changeContentsRequestSchema.parse(input);
    return changeContentsSchema.parse(
      await ipcRenderer.invoke(changesChannels.getContents, request),
    );
  },
  async review(input) {
    const request = reviewChangeRequestSchema.parse(input);
    return fileChangeSetSchema.parse(await ipcRenderer.invoke(changesChannels.review, request));
  },
  async reviewMany(input) {
    const request = reviewManyChangesRequestSchema.parse(input);
    return fileChangeSetSchema.parse(await ipcRenderer.invoke(changesChannels.reviewMany, request));
  },
  async editProposal(input) {
    const request = editChangeProposalRequestSchema.parse(input);
    return fileChangeSetSchema.parse(
      await ipcRenderer.invoke(changesChannels.editProposal, request),
    );
  },
  async apply(input) {
    const request = applyChangeSetRequestSchema.parse(input);
    return fileChangeSetSchema.parse(await ipcRenderer.invoke(changesChannels.apply, request));
  },
  async rollback(input) {
    const request = applyChangeSetRequestSchema.parse(input);
    return fileChangeSetSchema.parse(await ipcRenderer.invoke(changesChannels.rollback, request));
  },
};
