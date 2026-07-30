import { ipcMain } from 'electron';
import {
  appSettingsSchema,
  settingsChannels,
  updateAppSettingsRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { AppSettingsService } from '../settings/app-settings.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerSettingsIpc(
  options: TrustedRendererOptions,
  service: AppSettingsService,
): void {
  ipcMain.handle(settingsChannels.get, (event) => {
    assertTrustedIpcEvent(event, options);
    return appSettingsSchema.parse(service.get());
  });

  ipcMain.handle(settingsChannels.update, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = updateAppSettingsRequestSchema.parse(untrustedInput);
    return appSettingsSchema.parse(service.update(input));
  });
}

export function unregisterSettingsIpc(): void {
  Object.values(settingsChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
