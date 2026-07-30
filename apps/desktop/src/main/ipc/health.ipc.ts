import { ipcMain } from 'electron';
import {
  healthRequestSchema,
  healthResponseSchema,
  ipcChannels,
} from '@open-code-desk/ipc-contracts';

import { assertTrustedIpcEvent } from './assert-trusted-event';

interface RegisterHealthIpcOptions {
  readonly version: string;
  readonly rendererHtmlPath: string;
  readonly devServerUrl?: string;
}

export function registerHealthIpc(options: RegisterHealthIpcOptions): void {
  ipcMain.handle(ipcChannels.healthCheck, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = healthRequestSchema.parse(untrustedInput);

    return healthResponseSchema.parse({
      requestId: request.requestId,
      status: 'ok',
      version: options.version,
      timestamp: new Date().toISOString(),
    });
  });
}

export function unregisterHealthIpc(): void {
  ipcMain.removeHandler(ipcChannels.healthCheck);
}
