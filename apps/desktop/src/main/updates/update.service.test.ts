import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { UpdateService } from './update.service';

class FakeUpdater extends EventEmitter {
  public autoDownload = true;
  public autoInstallOnAppQuit = true;
  public allowPrerelease = true;
  public allowDowngrade = true;
  public disableWebInstaller = false;
  public logger: unknown = {};
  public readonly checkForUpdates = vi.fn(async () => undefined);
  public readonly downloadUpdate = vi.fn(async () => [] as ReadonlyArray<string>);
  public readonly quitAndInstall = vi.fn();
}

describe('UpdateService', () => {
  it('disables automatic download/install and reports the update lifecycle', async () => {
    const updater = new FakeUpdater();
    const statuses: string[] = [];
    const service = new UpdateService(updater, true, '1.0.0', (status) =>
      statuses.push(status.phase),
    );

    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      allowDowngrade: false,
      disableWebInstaller: true,
      logger: null,
    });
    const check = service.check();
    updater.emit('update-available', { version: '1.1.0' });
    await check;
    expect(service.getStatus()).toMatchObject({
      phase: 'available',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
    });

    const download = service.download();
    updater.emit('download-progress', { percent: 42.5 });
    updater.emit('update-downloaded', { version: '1.1.0' });
    await download;
    expect(service.getStatus()).toMatchObject({ phase: 'downloaded', progress: 100 });
    expect(service.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(statuses).toContain('downloading');
  });

  it('does not contact the update server in development mode', async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater, false, '0.1.0', vi.fn());

    expect(await service.check()).toMatchObject({ phase: 'unsupported' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('redacts credentials from update errors', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Bearer abc sk-abcdefghijklmnop'));
    const service = new UpdateService(updater, true, '1.0.0', vi.fn());

    expect(await service.check()).toMatchObject({
      phase: 'error',
      message: 'Bearer [REDACTED] [REDACTED]',
    });
  });
});
