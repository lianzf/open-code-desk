import type { IpcMainInvokeEvent } from 'electron';

import { isTrustedRendererUrl } from '../security/trusted-renderer';

export interface TrustedRendererOptions {
  readonly rendererHtmlPath: string;
  readonly devServerUrl?: string;
}

export function assertTrustedIpcEvent(
  event: IpcMainInvokeEvent,
  options: TrustedRendererOptions,
): void {
  const senderUrl = event.senderFrame?.url;

  if (
    senderUrl === undefined ||
    !isTrustedRendererUrl(senderUrl, options.rendererHtmlPath, options.devServerUrl)
  ) {
    throw new Error('IPC request rejected.');
  }
}
