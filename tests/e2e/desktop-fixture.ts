import { join } from 'node:path';

import { _electron as electron, type ElectronApplication } from '@playwright/test';

export async function launchDesktop(userDataDirectory: string): Promise<ElectronApplication> {
  const passwordStore = process.env.OPEN_CODE_DESK_E2E_PASSWORD_STORE;
  const application = await electron.launch({
    ...(passwordStore === undefined
      ? {}
      : { ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'] }),
    args: [
      ...(passwordStore === undefined ? [] : [`--password-store=${passwordStore}`]),
      join(process.cwd(), 'apps/desktop/out/main/main.js'),
      `--user-data-dir=${userDataDirectory}`,
    ],
  });

  // electron.launch resolves when the main process is connected, while tests also
  // require the renderer lifecycle to be ready before stubbing Electron APIs.
  await application.firstWindow();
  return application;
}
