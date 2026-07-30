import { ipcMain, webContents } from 'electron';
import {
  createTerminalRequestSchema,
  terminalActionResponseSchema,
  terminalChannels,
  terminalDataEventSchema,
  terminalExitEventSchema,
  terminalResizeRequestSchema,
  terminalSessionInfoSchema,
  terminalSessionRequestSchema,
  terminalWriteRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { TerminalSessionService } from '../terminal/terminal-session.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

let unsubscribe: (() => void) | undefined;
const trackedOwners = new Set<number>();

export function registerTerminalIpc(
  options: TrustedRendererOptions,
  service: TerminalSessionService,
): void {
  unsubscribe = service.subscribe((event) => {
    const owner = webContents.fromId(event.ownerId);
    if (owner === undefined || owner.isDestroyed()) {
      return;
    }
    if (event.type === 'data') {
      owner.send(
        terminalChannels.data,
        terminalDataEventSchema.parse({ sessionId: event.sessionId, data: event.data }),
      );
      return;
    }
    owner.send(
      terminalChannels.exit,
      terminalExitEventSchema.parse({
        sessionId: event.sessionId,
        exitCode: event.exitCode,
        ...(event.signal === undefined ? {} : { signal: event.signal }),
      }),
    );
  });

  ipcMain.handle(terminalChannels.create, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = createTerminalRequestSchema.parse(untrustedInput);
    const ownerId = event.sender.id;
    if (!trackedOwners.has(ownerId)) {
      trackedOwners.add(ownerId);
      event.sender.once('destroyed', () => {
        trackedOwners.delete(ownerId);
        service.closeOwner(ownerId);
      });
    }
    return terminalSessionInfoSchema.parse(
      await service.create(ownerId, input.workspaceId, input.cols, input.rows),
    );
  });

  ipcMain.handle(terminalChannels.write, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = terminalWriteRequestSchema.parse(untrustedInput);
    service.write(event.sender.id, input.sessionId, input.data);
    return terminalActionResponseSchema.parse({ accepted: true });
  });

  ipcMain.handle(terminalChannels.resize, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = terminalResizeRequestSchema.parse(untrustedInput);
    service.resize(event.sender.id, input.sessionId, input.cols, input.rows);
    return terminalActionResponseSchema.parse({ accepted: true });
  });

  ipcMain.handle(terminalChannels.close, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = terminalSessionRequestSchema.parse(untrustedInput);
    return terminalActionResponseSchema.parse({
      accepted: service.close(event.sender.id, input.sessionId),
    });
  });
}

export function unregisterTerminalIpc(): void {
  Object.values(terminalChannels)
    .filter((channel) => channel !== terminalChannels.data && channel !== terminalChannels.exit)
    .forEach((channel) => ipcMain.removeHandler(channel));
  unsubscribe?.();
  unsubscribe = undefined;
  trackedOwners.clear();
}
