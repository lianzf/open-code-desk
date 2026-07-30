import { ipcMain } from 'electron';
import {
  contextChannels,
  contextConversationRequestSchema,
  conversationContextItemSchema,
  conversationContextListSchema,
  deleteConversationContextRequestSchema,
  deleteConversationContextResponseSchema,
  saveConversationContextRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { ContextItemService } from '../context/context-item.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerContextIpc(
  options: TrustedRendererOptions,
  service: ContextItemService,
): void {
  ipcMain.handle(contextChannels.list, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = contextConversationRequestSchema.parse(untrustedInput);
    return conversationContextListSchema.parse(service.list(input.conversationId));
  });

  ipcMain.handle(contextChannels.save, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = saveConversationContextRequestSchema.parse(untrustedInput);
    return conversationContextItemSchema.parse(
      service.save({
        conversationId: input.conversationId,
        type: input.type,
        title: input.title,
        content: input.content,
        priority: input.priority,
        ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
      }),
    );
  });

  ipcMain.handle(contextChannels.delete, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deleteConversationContextRequestSchema.parse(untrustedInput);
    return deleteConversationContextResponseSchema.parse({
      deleted: service.delete(input.conversationId, input.contextItemId),
    });
  });
}

export function unregisterContextIpc(): void {
  Object.values(contextChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
