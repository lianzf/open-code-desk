import { join } from 'node:path';

import { app, BrowserWindow, dialog, nativeTheme } from 'electron';

import { registerApplicationIpc, unregisterApplicationIpc } from './bootstrap/application-ipc';
import {
  createApplicationServices,
  type ApplicationServices,
} from './bootstrap/application-services';
import { recordStartupFailure } from './bootstrap/startup-error-log';
import type { RecordCrashReportInput } from './crash/crash-report.service';
import { createMainWindow, resolvePreloadPath } from './window/create-main-window';

const rendererHtmlPath = join(__dirname, '../renderer/index.html');
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

// Playwright's Electron bootstrap reapplies the insecure Chromium test backend
// after process launch. Restore the explicitly requested Linux E2E backend
// before Electron becomes ready so the suite exercises the real Secret Service.
if (
  process.platform === 'linux' &&
  process.env.OPEN_CODE_DESK_E2E_PASSWORD_STORE === 'gnome-libsecret'
) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

let services: ApplicationServices | null = null;
let mainWindow: BrowserWindow | null = null;
let mainWindowOpening: Promise<void> | null = null;
let runCleanupInProgress = false;
let runCleanupCompleted = false;
let compoundRunClosed = false;
let startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function recordCrashSafely(input: RecordCrashReportInput): void {
  try {
    services?.crashReportService.record(input);
  } catch {
    // Crash reporting must never recursively fail the process it is observing.
  }
}

async function openMainWindow(): Promise<void> {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  if (mainWindowOpening !== null) {
    await mainWindowOpening;
    return;
  }

  const opening = (async () => {
    const window = await createMainWindow({
      preloadPath: resolvePreloadPath(__dirname),
      rendererHtmlPath,
      ...(devServerUrl === undefined ? {} : { devServerUrl }),
      onRendererGone: (details) => {
        recordCrashSafely({
          processType: 'renderer',
          reason: details.reason,
          exitCode: details.exitCode,
        });
        return (
          details.reason !== 'clean-exit' &&
          services?.crashReportService.shouldRecoverRenderer() === true
        );
      },
    });

    mainWindow = window;
    window.once('closed', () => {
      if (mainWindow === window) {
        mainWindow = null;
      }
    });
  })();

  mainWindowOpening = opening;
  try {
    await opening;
  } finally {
    if (mainWindowOpening === opening) {
      mainWindowOpening = null;
    }
  }
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  recordCrashSafely({
    processType: 'main',
    reason: 'uncaught_exception',
    details: {
      name: error.name,
      message: error.message,
      origin,
    },
  });
});

process.on('unhandledRejection', (reason) => {
  recordCrashSafely({
    processType: 'main',
    reason: 'unhandled_rejection',
    details: {
      message: reason instanceof Error ? reason.message : String(reason),
    },
  });
});

app.on('child-process-gone', (_event, details) => {
  recordCrashSafely({
    processType: 'child',
    reason: details.reason,
    exitCode: details.exitCode,
    details: {
      type: details.type,
      ...(details.name === undefined ? {} : { name: details.name }),
      ...(details.serviceName === undefined ? {} : { serviceName: details.serviceName }),
    },
  });
});

void app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId('dev.opencode.desk');

    const trustedRendererOptions = {
      rendererHtmlPath,
      ...(devServerUrl === undefined ? {} : { devServerUrl }),
    };

    services = await createApplicationServices();
    nativeTheme.themeSource = services.initialSettings.theme;
    registerApplicationIpc(trustedRendererOptions, services);

    await openMainWindow();
    if (services.initialSettings.autoCheckUpdates) {
      startupUpdateTimer = setTimeout(() => {
        void services?.updateService.check();
        startupUpdateTimer = null;
      }, 3_000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void openMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    const failure = recordStartupFailure(app.getPath('userData'), error);
    recordCrashSafely({
      processType: 'main',
      reason: 'startup_failed',
      details: { message: failure.message },
    });
    dialog.showErrorBox(
      'OpenCode Desk 启动失败',
      `应用无法完成初始化。\n\n${failure.message}\n\n请重启应用；若问题持续，${
        failure.logPath === undefined
          ? '启动错误日志也无法写入，请检查用户数据目录权限。'
          : `请查看启动错误记录：${failure.logPath}`
      }`,
    );
    app.exit(1);
  });

app.on('before-quit', (event) => {
  if (services !== null && !compoundRunClosed) {
    services.compoundRunService.close();
    compoundRunClosed = true;
  }
  if (services !== null && !runCleanupCompleted) {
    event.preventDefault();
    if (!runCleanupInProgress) {
      runCleanupInProgress = true;
      const activeServices = services;
      void Promise.allSettled([
        activeServices.runExecutionService.close(),
        activeServices.projectTaskExecutionService.close(),
        activeServices.debugSessionService.close(),
      ]).finally(() => {
        runCleanupCompleted = true;
        runCleanupInProgress = false;
        app.quit();
      });
    }
    return;
  }
  if (startupUpdateTimer !== null) {
    clearTimeout(startupUpdateTimer);
    startupUpdateTimer = null;
  }
  if (services !== null) {
    unregisterApplicationIpc(services);
    services.workspaceWatcher.close();
    services.commandService.close();
    services.toolApprovalService.close();
    services.terminalService.closeAll();
    services.database.close();
    services = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
