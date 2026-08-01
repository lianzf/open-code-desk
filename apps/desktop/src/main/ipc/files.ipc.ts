import { ipcMain } from 'electron';
import {
  cancelFileSearchRequestSchema,
  cancelFileSearchResponseSchema,
  createDirectoryRequestSchema,
  createFileRequestSchema,
  deletePathRequestSchema,
  fileEntryListSchema,
  fileMutationResponseSchema,
  filesChannels,
  listDirectoryRequestSchema,
  readFileRequestSchema,
  readFileResponseSchema,
  movePathRequestSchema,
  searchFilesRequestSchema,
  searchTextRequestSchema,
  textSearchResponseSchema,
  writeFileRequestSchema,
  writeFileResponseSchema,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

const searchControllers = new Map<string, AbortController>();

export function registerFilesIpc(
  options: TrustedRendererOptions,
  service: WorkspaceFileService,
): void {
  ipcMain.handle(filesChannels.createFile, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = createFileRequestSchema.parse(untrustedInput);
    return fileMutationResponseSchema.parse(
      await service.createFile(request.workspaceId, request.relativePath, request.content),
    );
  });

  ipcMain.handle(filesChannels.createDirectory, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = createDirectoryRequestSchema.parse(untrustedInput);
    return fileMutationResponseSchema.parse(
      await service.createDirectory(request.workspaceId, request.relativePath),
    );
  });

  ipcMain.handle(filesChannels.movePath, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = movePathRequestSchema.parse(untrustedInput);
    return fileMutationResponseSchema.parse(
      await service.movePath(request.workspaceId, request.sourcePath, request.destinationPath),
    );
  });

  ipcMain.handle(filesChannels.deletePath, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = deletePathRequestSchema.parse(untrustedInput);
    return fileMutationResponseSchema.parse(
      await service.deletePath(request.workspaceId, request.relativePath),
    );
  });

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

  ipcMain.handle(filesChannels.searchText, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = searchTextRequestSchema.parse(untrustedInput);
    searchControllers.get(request.requestId)?.abort();
    const controller = new AbortController();
    searchControllers.set(request.requestId, controller);
    try {
      return textSearchResponseSchema.parse(
        await service.searchText(
          request.workspaceId,
          request.query,
          request.path,
          request.caseSensitive,
          request.limit,
          controller.signal,
        ),
      );
    } finally {
      if (searchControllers.get(request.requestId) === controller) {
        searchControllers.delete(request.requestId);
      }
    }
  });

  ipcMain.handle(filesChannels.cancelSearch, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const request = cancelFileSearchRequestSchema.parse(untrustedInput);
    const controller = searchControllers.get(request.requestId);
    controller?.abort();
    return cancelFileSearchResponseSchema.parse({ cancelled: controller !== undefined });
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
  searchControllers.forEach((controller) => controller.abort());
  searchControllers.clear();
  Object.values(filesChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
