import { ipcMain } from 'electron';
import {
  gitChannels,
  gitDiffRequestSchema,
  gitDiffSchema,
  gitStatusRequestSchema,
  gitStatusSchema,
} from '@open-code-desk/ipc-contracts';

import type { GitService } from '../git/git.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerGitIpc(options: TrustedRendererOptions, service: GitService): void {
  ipcMain.handle(gitChannels.status, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = gitStatusRequestSchema.parse(untrustedInput);
    return gitStatusSchema.parse(await service.status(input.workspaceId));
  });

  ipcMain.handle(gitChannels.diff, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = gitDiffRequestSchema.parse(untrustedInput);
    return gitDiffSchema.parse(
      await service.diff({
        workspaceId: input.workspaceId,
        staged: input.staged,
        maxCharacters: input.maxCharacters,
        ...(input.path === undefined ? {} : { path: input.path }),
      }),
    );
  });
}

export function unregisterGitIpc(): void {
  Object.values(gitChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
