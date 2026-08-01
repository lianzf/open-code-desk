import { ipcMain } from 'electron';
import {
  attachDebugContextRequestSchema,
  attachDebugContextResponseSchema,
  debugContextChannels,
  debugContextSnapshotSchema,
  previewDebugContextRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { DebugContextService } from '../debug/debug-context.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerDebugContextIpc(
  options: TrustedRendererOptions,
  service: DebugContextService,
): void {
  ipcMain.handle(debugContextChannels.preview, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = previewDebugContextRequestSchema.parse(untrustedInput);
    return debugContextSnapshotSchema.parse(await service.preview(input));
  });

  ipcMain.handle(debugContextChannels.attach, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = attachDebugContextRequestSchema.parse(untrustedInput);
    return attachDebugContextResponseSchema.parse(service.attach(input));
  });
}

export function unregisterDebugContextIpc(): void {
  Object.values(debugContextChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
