import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { launchDesktop } from './desktop-fixture';

async function reserveFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port.');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function createFirstService(window: Page, port: number): Promise<void> {
  await window.getByTestId('open-run-configuration').click();
  const dialog = window.getByTestId('run-configuration-dialog');
  await dialog.getByTestId('run-config-name').fill('frontend');
  await dialog.getByTestId('run-config-type').selectOption('node');
  await dialog.getByTestId('run-config-executable').fill(process.execPath);
  await dialog.getByTestId('run-config-runtime-args').fill('-e');
  await dialog
    .getByTestId('run-config-args')
    .fill('process.stdout.write("FRONTEND_READY\\n"); setInterval(() => undefined, 1000)');
  await dialog.getByTestId('run-config-port').fill(String(port));
  await dialog.getByTestId('inspect-run-port').click();
  await expect(dialog.getByTestId('run-port-inspection')).toContainText('可用');
  await dialog.getByTestId('save-run-configuration').click();
  await expect(dialog).not.toBeVisible();
}

async function duplicateAsSecondService(window: Page): Promise<void> {
  await window.getByTestId('open-run-configuration').click();
  const dialog = window.getByTestId('run-configuration-dialog');
  await dialog.getByTestId('duplicate-run-configuration').click();
  await dialog.getByTestId('run-config-name').fill('backend');
  await dialog
    .getByTestId('run-config-args')
    .fill('process.stdout.write("BACKEND_READY\\n"); setInterval(() => undefined, 1000)');
  await dialog.getByTestId('run-config-port').fill('');
  await dialog.getByTestId('save-run-configuration').click();
  await expect(dialog).not.toBeVisible();
}

test('creates, batch-approves, monitors, stops, and restores a compound run', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-compound-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-compound-user-'));
  const port = await reserveFreePort();
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

    await createFirstService(window, port);
    await duplicateAsSecondService(window);
    await expect(window.getByTestId('open-compound-run')).toBeEnabled();
    await window.getByTestId('open-compound-run').click();
    const compoundDialog = window.getByTestId('compound-run-dialog');
    await compoundDialog.getByTestId('compound-run-name').fill('full stack');
    await compoundDialog.locator('label', { hasText: 'frontend' }).getByRole('checkbox').check();
    await compoundDialog.locator('label', { hasText: 'backend' }).getByRole('checkbox').check();
    await compoundDialog.getByTestId('save-compound-run').click();
    await compoundDialog.getByTestId('propose-compound-run').click();

    const approval = window.getByTestId('compound-run-approval');
    await expect(approval).toBeVisible();
    await expect(approval).toContainText('frontend');
    await expect(approval).toContainText('backend');
    await expect(approval).toContainText(`端口 ${port}`);
    await approval.getByTestId('approve-compound-run').click();
    await expect(approval).not.toBeVisible();

    await window.getByTestId('toggle-run-output').click();
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const workspace = await window.openCodeDesk.workspace.getCurrent();
            if (workspace === null) return [];
            return (
              await window.openCodeDesk.run.listHistory({ workspaceId: workspace.id, limit: 2 })
            )
              .map((execution) => execution.status)
              .sort();
          }),
        { timeout: 15_000 },
      )
      .toEqual(['running', 'running']);
    const historySelect = window.getByTestId('run-history-select');
    await expect(historySelect.locator('option')).toHaveCount(2);
    const frontendExecutionId = await historySelect
      .locator('option', { hasText: 'frontend' })
      .getAttribute('value');
    const backendExecutionId = await historySelect
      .locator('option', { hasText: 'backend' })
      .getAttribute('value');
    if (frontendExecutionId === null || backendExecutionId === null) {
      throw new Error('Expected both service execution options.');
    }
    await historySelect.selectOption(frontendExecutionId);
    await expect(window.getByTestId('run-output')).toContainText('FRONTEND_READY');
    await historySelect.selectOption(backendExecutionId);
    await expect(window.getByTestId('run-output')).toContainText('BACKEND_READY');

    await window.getByTestId('open-compound-run').click();
    await compoundDialog.getByTestId('stop-compound-run').click();
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const workspace = await window.openCodeDesk.workspace.getCurrent();
            if (workspace === null) return [];
            return (
              await window.openCodeDesk.run.listHistory({ workspaceId: workspace.id, limit: 2 })
            )
              .map((execution) => execution.status)
              .sort();
          }),
        { timeout: 15_000 },
      )
      .toEqual(['stopped', 'stopped']);

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByTestId('open-compound-run').click();
    await expect(window.getByTestId('compound-run-dialog')).toContainText('full stack');
  } finally {
    if (application !== undefined) await application.close();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
