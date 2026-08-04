import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop } from './desktop-fixture';

test('discovers a Python interpreter and completes a real breakpoint debug flow', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-python-e2e-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-python-user-'));
  await writeFile(
    join(projectDirectory, 'main.py'),
    [
      'import time',
      'def add(left, right):',
      '    total = left + right',
      '    return total',
      'answer = add(20, 22)',
      "print(f'PYTHON_DEBUG_READY:{answer}', flush=True)",
      'while True:',
      '    time.sleep(0.05)',
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
    const window = await application.firstWindow();
    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();

    await window.getByTestId('open-run-configuration').click();
    await window.getByTestId('run-config-name').fill('Python 断点调试');
    await window.getByTestId('run-config-type').selectOption('python');
    const interpreterSelect = window.getByTestId('run-config-python-interpreter');
    await expect(interpreterSelect.locator('option')).not.toHaveCount(1);
    await interpreterSelect.selectOption({ index: 1 });
    await window.getByTestId('run-config-args').fill('main.py');
    await window.getByTestId('save-run-configuration').click();

    await window.getByTestId('tree-entry-main.py').click();
    const editor = window.locator('.monaco-editor').first();
    await editor.locator('.view-line').filter({ hasText: 'return total' }).click();
    await window.keyboard.press('F9');
    await window.getByTestId('toggle-debug').click();
    await expect(window.getByTestId('debug-breakpoint-item')).toContainText('main.py:4');

    await window.getByTestId('propose-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('等待批准');
    await window.getByTestId('approve-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已暂停', { timeout: 20_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('main.py:4');
    await expect(window.getByTestId('debug-panel')).toContainText(/total\s*=\s*42/u);
    await expect(window.locator('.debug-current-line')).toBeVisible();

    await window.getByTestId('debug-next').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已暂停', { timeout: 10_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('main.py:5');
    await window.getByTestId('debug-toggle-pause').click();
    await expect(window.getByTestId('debug-panel')).toContainText('PYTHON_DEBUG_READY:42');
    await window.getByTestId('stop-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已停止');
  } finally {
    if (application !== undefined) await application.close();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
