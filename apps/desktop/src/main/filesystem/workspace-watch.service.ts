import { watch, type FSWatcher } from 'node:fs';

import { BrowserWindow } from 'electron';
import {
  fileChangedEventSchema,
  filesChannels,
  type WorkspaceInfo,
} from '@open-code-desk/ipc-contracts';

import {
  ignoredDirectoryNames,
  isSensitiveRelativePath,
  normalizeRelativePath,
} from './path-policy';

export class WorkspaceWatchService {
  private watcher: FSWatcher | null = null;
  private readonly pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>();

  public start(workspace: WorkspaceInfo): void {
    this.close();

    this.watcher = watch(
      workspace.rootPath,
      {
        recursive: true,
        encoding: 'utf8',
      },
      (eventType, fileName) => {
        if (fileName === null) {
          return;
        }

        let relativePath: string;
        try {
          relativePath = normalizeRelativePath(fileName);
        } catch {
          return;
        }

        if (
          relativePath === '' ||
          isSensitiveRelativePath(relativePath) ||
          relativePath
            .split('/')
            .some((segment) => ignoredDirectoryNames.has(segment.toLocaleLowerCase('en-US')))
        ) {
          return;
        }

        const existingTimeout = this.pendingNotifications.get(relativePath);
        if (existingTimeout !== undefined) {
          clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(() => {
          this.pendingNotifications.delete(relativePath);
          const event = fileChangedEventSchema.parse({
            workspaceId: workspace.id,
            relativePath,
            event: eventType === 'rename' ? 'renamed' : 'changed',
          });

          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.webContents.isDestroyed()) {
              window.webContents.send(filesChannels.changed, event);
            }
          }
        }, 80);

        this.pendingNotifications.set(relativePath, timeout);
      },
    );

    this.watcher.on('error', () => {
      this.close();
    });
  }

  public close(): void {
    this.watcher?.close();
    this.watcher = null;

    for (const timeout of this.pendingNotifications.values()) {
      clearTimeout(timeout);
    }
    this.pendingNotifications.clear();
  }
}
