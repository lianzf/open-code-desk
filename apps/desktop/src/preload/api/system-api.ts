import { ipcRenderer } from 'electron';

import {
  gitChannels,
  gitDiffRequestSchema,
  gitDiffSchema,
  gitStatusRequestSchema,
  gitStatusSchema,
  installUpdateResponseSchema,
  type DesktopApi,
  updateActionRequestSchema,
  updateChannels,
  updateStatusSchema,
} from '@open-code-desk/ipc-contracts';

export const updatesApi: DesktopApi['updates'] = {
  async getStatus() {
    const request = updateActionRequestSchema.parse({});
    return updateStatusSchema.parse(await ipcRenderer.invoke(updateChannels.getStatus, request));
  },
  async check() {
    const request = updateActionRequestSchema.parse({});
    return updateStatusSchema.parse(await ipcRenderer.invoke(updateChannels.check, request));
  },
  async download() {
    const request = updateActionRequestSchema.parse({});
    return updateStatusSchema.parse(await ipcRenderer.invoke(updateChannels.download, request));
  },
  async install() {
    const request = updateActionRequestSchema.parse({});
    return installUpdateResponseSchema.parse(
      await ipcRenderer.invoke(updateChannels.install, request),
    );
  },
  onStatusChanged(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedStatus: unknown) => {
      listener(updateStatusSchema.parse(untrustedStatus));
    };
    ipcRenderer.on(updateChannels.statusChanged, wrappedListener);
    return () => ipcRenderer.removeListener(updateChannels.statusChanged, wrappedListener);
  },
};

export const gitApi: DesktopApi['git'] = {
  async status(input) {
    const request = gitStatusRequestSchema.parse(input);
    return gitStatusSchema.parse(await ipcRenderer.invoke(gitChannels.status, request));
  },
  async diff(input) {
    const request = gitDiffRequestSchema.parse(input);
    return gitDiffSchema.parse(await ipcRenderer.invoke(gitChannels.diff, request));
  },
};
