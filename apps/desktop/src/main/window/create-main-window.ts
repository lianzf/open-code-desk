import { join } from 'node:path';

import { BrowserWindow, shell, type RenderProcessGoneDetails } from 'electron';

export interface CreateMainWindowOptions {
  readonly preloadPath: string;
  readonly rendererHtmlPath: string;
  readonly devServerUrl?: string;
  readonly onRendererGone?: (details: RenderProcessGoneDetails) => boolean;
}

export async function createMainWindow(options: CreateMainWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#09090b',
    title: 'OpenCode Desk',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol === 'https:') {
      void shell.openExternal(parsedUrl.toString());
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    if (options.onRendererGone?.(details) !== true) {
      return;
    }
    setTimeout(() => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.reload();
      }
    }, 500);
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  if (options.devServerUrl !== undefined) {
    await window.loadURL(options.devServerUrl);
  } else {
    await window.loadFile(options.rendererHtmlPath);
  }

  return window;
}

export function resolvePreloadPath(mainOutputDirectory: string): string {
  return join(mainOutputDirectory, '../preload/index.cjs');
}
