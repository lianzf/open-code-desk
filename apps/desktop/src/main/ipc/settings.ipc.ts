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
  onUpdated?: (settings: ReturnType<AppSettingsService['update']>) => void,
): void {
  ipcMain.handle(settingsChannels.get, (event) => {
    assertTrustedIpcEvent(event, options);
    return appSettingsSchema.parse(service.get());
  });

  ipcMain.handle(settingsChannels.update, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = updateAppSettingsRequestSchema.parse(untrustedInput);
    const settings = appSettingsSchema.parse(service.update(input));
    onUpdated?.(settings);
    return settings;
  });
}

export function unregisterSettingsIpc(): void {
  Object.values(settingsChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
