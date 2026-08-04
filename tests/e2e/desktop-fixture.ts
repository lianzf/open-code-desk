import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication } from '@playwright/test';

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
