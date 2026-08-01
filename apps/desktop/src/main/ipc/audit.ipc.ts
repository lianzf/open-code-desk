import { ipcMain } from 'electron';
import {
  auditChannels,
  auditEventListSchema,
  listAuditEventsRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerAuditIpc(options: TrustedRendererOptions, service: AuditLogService): void {
  ipcMain.handle(auditChannels.list, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listAuditEventsRequestSchema.parse(untrustedInput);
    return auditEventListSchema.parse(
      service.list({
        workspaceId: input.workspaceId,
        limit: input.limit,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      }),
    );
  });
}

export function unregisterAuditIpc(): void {
  Object.values(auditChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
