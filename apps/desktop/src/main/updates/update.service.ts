import type { UpdateStatus } from '@open-code-desk/ipc-contracts';

import { redactAuditText } from '../audit/audit-log.service';

interface UpdateInfo {
  readonly version: string;
}

interface DownloadProgress {
  readonly percent: number;
}

interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  logger: unknown;
  on(event: 'checking-for-update', listener: () => void): this;
  on(event: 'update-available', listener: (info: UpdateInfo) => void): this;
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): this;
  on(event: 'download-progress', listener: (progress: DownloadProgress) => void): this;
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<ReadonlyArray<string>>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export class UpdateService {
  private status: UpdateStatus;

  public constructor(
    private readonly updater: UpdaterLike,
    private readonly packaged: boolean,
    private readonly currentVersion: string,
    private readonly onStatusChanged: (status: UpdateStatus) => void,
  ) {
    this.status = packaged
      ? { phase: 'idle', currentVersion }
      : {
          phase: 'unsupported',
          currentVersion,
          message: '更新检查仅在已安装的正式版本中可用。',
        };
    this.configureUpdater();
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  public async check(): Promise<UpdateStatus> {
    if (!this.packaged) {
      return this.status;
    }
    this.setStatus({ phase: 'checking', currentVersion: this.currentVersion });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setError(error);
    }
    return this.status;
  }

  public async download(): Promise<UpdateStatus> {
    if (this.status.phase !== 'available') {
      return this.status;
    }
    this.setStatus({
      ...this.status,
      phase: 'downloading',
      progress: 0,
    });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.setError(error);
    }
    return this.status;
  }

  public install(): true {
    if (this.status.phase !== 'downloaded') {
      throw new Error('Update has not finished downloading.');
    }
    this.updater.quitAndInstall(false, true);
    return true;
  }

  private configureUpdater(): void {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.disableWebInstaller = true;
    this.updater.logger = null;
    this.updater.on('checking-for-update', () => {
      this.setStatus({ phase: 'checking', currentVersion: this.currentVersion });
    });
    this.updater.on('update-available', (info) => {
      this.setStatus({
        phase: 'available',
        currentVersion: this.currentVersion,
        availableVersion: info.version,
        checkedAt: new Date().toISOString(),
      });
    });
    this.updater.on('update-not-available', () => {
      this.setStatus({
        phase: 'not_available',
        currentVersion: this.currentVersion,
        checkedAt: new Date().toISOString(),
      });
    });
    this.updater.on('download-progress', (progress) => {
      this.setStatus({
        ...this.status,
        phase: 'downloading',
        progress: Math.min(Math.max(progress.percent, 0), 100),
      });
    });
    this.updater.on('update-downloaded', (info) => {
      this.setStatus({
        phase: 'downloaded',
        currentVersion: this.currentVersion,
        availableVersion: info.version,
        progress: 100,
        checkedAt: this.status.checkedAt ?? new Date().toISOString(),
      });
    });
    this.updater.on('error', (error) => this.setError(error));
  }

  private setError(error: unknown): void {
    const rawMessage = error instanceof Error ? error.message : String(error);
    this.setStatus({
      phase: 'error',
      currentVersion: this.currentVersion,
      message: redactAuditText(rawMessage).slice(0, 1_000),
      checkedAt: new Date().toISOString(),
    });
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.onStatusChanged(status);
  }
}
