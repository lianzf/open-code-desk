import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

function launchDesktop(userDataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      join(process.cwd(), 'apps/desktop/out/main/main.js'),
      `--user-data-dir=${userDataDirectory}`,
    ],
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('detects, approves, runs, stops, restarts, and safely restores a project run', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-user-'));
  const startedPath = join(projectDirectory, 'run-e2e-started.txt');
  const heartbeatPath = join(projectDirectory, 'run-e2e-heartbeat.txt');
  await writeFile(
    join(projectDirectory, 'package.json'),
    JSON.stringify({
      name: 'open-code-desk-run-e2e',
      private: true,
      scripts: { start: 'node server.js' },
    }),
    'utf8',
  );
  await writeFile(
    join(projectDirectory, 'server.js'),
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync("run-e2e-started.txt", String(process.pid));',
      'process.stdout.write("RUN_E2E_READY\\n");',
      'setInterval(() => fs.appendFileSync("run-e2e-heartbeat.txt", "x"), 100);',
    ].join('\n'),
    'utf8',
  );
  let application: ElectronApplication | undefined;

  try {
    application = await launchDesktop(userDataDirectory);
    await application.evaluate(({ dialog }, selectedDirectory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedDirectory] }),
      });
    }, projectDirectory);
    let window = await application.firstWindow();
    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();

    const configurationSelect = window.getByTestId('run-configuration-select');
    await expect(configurationSelect).toBeEnabled();
    await expect(configurationSelect.locator('option[value="suggestion:0"]')).toContainText(
      'package.json · start',
    );
    await configurationSelect.selectOption('suggestion:0');
    await expect(configurationSelect).not.toHaveValue('');

    await window.getByTestId('propose-run').click();
    const outputPanel = window.getByTestId('run-output-panel');
    await expect(outputPanel).toBeVisible();
    await expect(outputPanel.getByText('等待批准', { exact: true }).first()).toBeVisible();
    expect(await exists(startedPath)).toBe(false);
    await window.getByTestId('approve-run').click();
    await expect(window.getByTestId('run-output')).toContainText('RUN_E2E_READY');
    await expect.poll(async () => exists(startedPath)).toBe(true);

    await window.getByTestId('stop-run').click();
    await expect(outputPanel.getByText('已停止', { exact: true }).first()).toBeVisible();
    await window.getByTestId('restart-run').click();
    await expect(outputPanel.getByText('等待批准', { exact: true }).first()).toBeVisible();
    await window.getByTestId('approve-run').click();
    await expect(window.getByTestId('run-output')).toContainText('RUN_E2E_READY');
    await expect(window.getByTestId('stop-run')).toBeEnabled();

    await application.close();
    application = undefined;
    const heartbeatAfterClose = await readFile(heartbeatPath, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readFile(heartbeatPath, 'utf8')).toBe(heartbeatAfterClose);

    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByTestId('toggle-run-output').click();
    await expect(window.getByTestId('run-output-panel')).toBeVisible();
    await expect(
      window.getByTestId('run-output-panel').getByText('已停止', { exact: true }).first(),
    ).toBeVisible();
    await expect(window.getByTestId('run-output')).toContainText('RUN_E2E_READY');
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
