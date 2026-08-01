import { ipcMain } from 'electron';
import {
  installUpdateResponseSchema,
  updateActionRequestSchema,
  updateChannels,
  updateStatusSchema,
} from '@open-code-desk/ipc-contracts';

import type { UpdateService } from '../updates/update.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerUpdatesIpc(options: TrustedRendererOptions, service: UpdateService): void {
  ipcMain.handle(updateChannels.getStatus, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    updateActionRequestSchema.parse(untrustedInput);
    return updateStatusSchema.parse(service.getStatus());
  });
  ipcMain.handle(updateChannels.check, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    updateActionRequestSchema.parse(untrustedInput);
    return updateStatusSchema.parse(await service.check());
  });
  ipcMain.handle(updateChannels.download, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    updateActionRequestSchema.parse(untrustedInput);
    return updateStatusSchema.parse(await service.download());
  });
  ipcMain.handle(updateChannels.install, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    updateActionRequestSchema.parse(untrustedInput);
    service.install();
    return installUpdateResponseSchema.parse({ accepted: true });
  });
}

export function unregisterUpdatesIpc(): void {
  Object.values(updateChannels)
    .filter((channel) => channel !== updateChannels.statusChanged)
    .forEach((channel) => ipcMain.removeHandler(channel));
}
