import { ipcMain } from 'electron';
import {
  fileEntryListSchema,
  filesChannels,
  listDirectoryRequestSchema,
  readFileRequestSchema,
  readFileResponseSchema,
  searchFilesRequestSchema,
  writeFileRequestSchema,
  writeFileResponseSchema,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerFilesIpc(
  options: TrustedRendererOptions,
  service: WorkspaceFileService,
): void {
  ipcMain.handle(filesChannels.listDirectory, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = listDirectoryRequestSchema.parse(untrustedInput);
    return fileEntryListSchema.parse(
      await service.listDirectory(request.workspaceId, request.relativePath),
    );
  });

  ipcMain.handle(filesChannels.readFile, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = readFileRequestSchema.parse(untrustedInput);
    return readFileResponseSchema.parse(
      await service.readFile(request.workspaceId, request.relativePath),
    );
  });

  ipcMain.handle(filesChannels.searchFiles, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = searchFilesRequestSchema.parse(untrustedInput);
    return fileEntryListSchema.parse(
      await service.searchFiles(request.workspaceId, request.query, request.limit),
    );
  });

  ipcMain.handle(filesChannels.writeFile, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = writeFileRequestSchema.parse(untrustedInput);
    return writeFileResponseSchema.parse(
      await service.writeFile(
        request.workspaceId,
        request.relativePath,
        request.content,
        request.expectedHash,
      ),
    );
  });
}

export function unregisterFilesIpc(): void {
  Object.values(filesChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
