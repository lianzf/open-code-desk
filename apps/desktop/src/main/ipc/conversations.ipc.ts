import { writeFile } from 'node:fs/promises';

import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  conversationDetailSchema,
  conversationIdRequestSchema,
  conversationListSchema,
  conversationSchema,
  conversationsChannels,
  createConversationRequestSchema,
  deleteConversationResponseSchema,
  exportConversationResponseSchema,
  listConversationsRequestSchema,
  renameConversationRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { ConversationService } from '../conversations/conversation.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

function safeFileName(title: string): string {
  const sanitized = title.replaceAll(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  return (sanitized || 'OpenCode Desk conversation').slice(0, 120);
}

export function registerConversationsIpc(
  options: TrustedRendererOptions,
  service: ConversationService,
): void {
  ipcMain.handle(conversationsChannels.list, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listConversationsRequestSchema.parse(untrustedInput);
    return conversationListSchema.parse(service.list(input.workspaceId, input.query));
  });

  ipcMain.handle(conversationsChannels.create, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = createConversationRequestSchema.parse(untrustedInput);
    return conversationSchema.parse(await service.create(input));
  });

  ipcMain.handle(conversationsChannels.get, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = conversationIdRequestSchema.parse(untrustedInput);
    return conversationDetailSchema.parse(service.get(input.conversationId));
  });

  ipcMain.handle(conversationsChannels.rename, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = renameConversationRequestSchema.parse(untrustedInput);
    return conversationSchema.parse(service.rename(input.conversationId, input.title));
  });

  ipcMain.handle(conversationsChannels.delete, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = conversationIdRequestSchema.parse(untrustedInput);
    return deleteConversationResponseSchema.parse({
      deleted: service.delete(input.conversationId),
    });
  });

  ipcMain.handle(conversationsChannels.exportMarkdown, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = conversationIdRequestSchema.parse(untrustedInput);
    const exported = service.toMarkdown(input.conversationId);
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const selection =
      owner === undefined
        ? await dialog.showSaveDialog({
            defaultPath: `${safeFileName(exported.title)}.md`,
            filters: [{ name: 'Markdown', extensions: ['md'] }],
          })
        : await dialog.showSaveDialog(owner, {
            defaultPath: `${safeFileName(exported.title)}.md`,
            filters: [{ name: 'Markdown', extensions: ['md'] }],
          });
    if (selection.canceled || selection.filePath === '') {
      return exportConversationResponseSchema.parse({ saved: false });
    }
    await writeFile(selection.filePath, exported.markdown, { encoding: 'utf8', flag: 'w' });
    return exportConversationResponseSchema.parse({
      saved: true,
      path: selection.filePath,
    });
  });
}

export function unregisterConversationsIpc(): void {
  Object.values(conversationsChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
