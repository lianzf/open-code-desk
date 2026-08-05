import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

interface LaunchDesktopOptions {
  readonly exposeGarbageCollector?: boolean;
  readonly executablePath?: string;
}

export async function launchDesktop(
  userDataDirectory: string,
  options: LaunchDesktopOptions = {},
): Promise<ElectronApplication> {
  const passwordStore = process.env.OPEN_CODE_DESK_E2E_PASSWORD_STORE;
  const executablePath = options.executablePath ?? process.env.OPEN_CODE_DESK_E2E_EXECUTABLE_PATH;
  const application = await electron.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    ...(passwordStore === undefined
      ? {}
      : { ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'] }),
    args: [
      ...(passwordStore === undefined ? [] : [`--password-store=${passwordStore}`]),
      ...(options.exposeGarbageCollector === true ? ['--js-flags=--expose-gc'] : []),
      ...(executablePath === undefined
        ? [join(process.cwd(), 'apps/desktop/out/main/main.js')]
        : []),
      `--user-data-dir=${userDataDirectory}`,
    ],
  });

  // electron.launch resolves when the main process is connected, while tests also
  // require the renderer lifecycle to be ready before stubbing Electron APIs.
  await application.firstWindow();
  return application;
}

export async function removeTestDirectory(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function expectDebugSessionStatus(
  page: Page,
  expectedStatus: string,
  timeout = 20_000,
): Promise<void> {
  try {
    await expect
      .poll(
        async () => {
          const status = await page.getByTestId('debug-status').getAttribute('data-status');
          if (status === 'failed') {
            const detail = await page.locator('[data-testid="debug-error"]').allTextContents();
            throw new Error(`Debug session failed: ${detail.join(' ').trim() || 'no detail'}`);
          }
          return status;
        },
        { timeout },
      )
      .toBe(expectedStatus);
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      const workspace = await window.openCodeDesk.workspace.getCurrent();
      if (workspace === null) return [];
      const history = await window.openCodeDesk.debug.listHistory({
        workspaceId: workspace.id,
        limit: 5,
      });
      return history.map((session) => ({
        id: session.id,
        status: session.status,
        adapterType: session.adapterType,
        adapterProcessId: session.adapterProcessId,
        error: session.error,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      }));
    });
    throw new Error(`${errorText(error)}\nDebug history: ${JSON.stringify(diagnostics)}`);
  }
}

export async function expectRunOutput(
  page: Page,
  expectedText: string,
  timeout = 20_000,
): Promise<void> {
  try {
    await expect
      .poll(
        async () => {
          const output = (await page.getByTestId('run-output').textContent()) ?? '';
          if (output.includes(expectedText)) return output;

          const status = await page.getByTestId('run-status').getAttribute('data-status');
          if (['completed', 'failed', 'rejected', 'stopped'].includes(status ?? '')) {
            const details = await page
              .locator('[data-testid="run-execution-error"], [data-testid="run-error"]')
              .allTextContents();
            throw new Error(
              `Run reached ${status} before expected output: ${details.join(' ').trim() || 'no detail'}`,
            );
          }
          return output;
        },
        { timeout },
      )
      .toContain(expectedText);
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      const workspace = await window.openCodeDesk.workspace.getCurrent();
      if (workspace === null) return [];
      const history = await window.openCodeDesk.run.listHistory({
        workspaceId: workspace.id,
        limit: 5,
      });
      return history.map((execution) => ({
        id: execution.id,
        status: execution.status,
        processId: execution.processId,
        exitCode: execution.exitCode,
        terminationSignal: execution.terminationSignal,
        outputBytes: execution.outputBytes,
        outputTruncated: execution.outputTruncated,
        error: execution.error,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      }));
    });
    throw new Error(`${errorText(error)}\nRun history: ${JSON.stringify(diagnostics)}`);
  }
}
