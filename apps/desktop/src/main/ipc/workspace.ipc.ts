import { ipcMain } from 'electron';
import {
  nullableWorkspaceInfoSchema,
  openRecentWorkspaceRequestSchema,
  workspaceChannels,
  workspaceInfoListSchema,
  workspaceInfoSchema,
  type WorkspaceInfo,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceService } from '../workspace/workspace.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerWorkspaceIpc(
  options: TrustedRendererOptions,
  service: WorkspaceService,
  onWorkspaceOpened: (workspace: WorkspaceInfo) => void,
): void {
  ipcMain.handle(workspaceChannels.getCurrent, (event) => {
    assertTrustedIpcEvent(event, options);
    return nullableWorkspaceInfoSchema.parse(service.getCurrent());
  });

  ipcMain.handle(workspaceChannels.listRecent, (event) => {
    assertTrustedIpcEvent(event, options);
    return workspaceInfoListSchema.parse(service.listRecent());
  });

  ipcMain.handle(workspaceChannels.openDialog, async (event) => {
    assertTrustedIpcEvent(event, options);
    const workspace = nullableWorkspaceInfoSchema.parse(await service.openFromDialog());
    if (workspace !== null) {
      onWorkspaceOpened(workspace);
    }
    return workspace;
  });

  ipcMain.handle(workspaceChannels.openRecent, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = openRecentWorkspaceRequestSchema.parse(untrustedInput);
    const workspace = workspaceInfoSchema.parse(await service.openRecent(request.workspaceId));
    onWorkspaceOpened(workspace);
    return workspace;
  });
}

export function unregisterWorkspaceIpc(): void {
  Object.values(workspaceChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
