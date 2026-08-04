import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop, removeTestDirectory } from './desktop-fixture';

test('edits, executes and restores advanced breakpoints and exception rules', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-advanced-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-advanced-user-'));
  const completedPath = join(projectDirectory, 'advanced-finished.txt');
  await writeFile(
    join(projectDirectory, 'program.js'),
    [
      'const fs = require("node:fs");',
      'for (let i = 0; i < 5; i += 1) {',
      '  const doubled = i * 2;',
      '  const checkpoint = doubled + 1;',
      '  process.stdout.write(`LOOP:${i}:${checkpoint}\\n`);',
      '}',
      'fs.writeFileSync("advanced-finished.txt", "done");',
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

    await window.getByTestId('open-run-configuration').click();
    await window.getByTestId('run-config-name').fill('Node 高级断点');
    await window.getByTestId('run-config-type').selectOption('node');
    await window.getByTestId('run-config-executable').fill(process.execPath);
    await window.getByTestId('run-config-args').fill('program.js');
    await window.getByTestId('save-run-configuration').click();

    await window.getByTestId('tree-entry-program.js').click();
    const editor = window.locator('.monaco-editor').first();
    await editor.locator('.view-line').filter({ hasText: 'const doubled' }).click();
    await window.keyboard.press('F9');
    await window.getByTestId('toggle-debug').click();
    let breakpoints = window.getByTestId('debug-breakpoint-item');
    await expect(breakpoints).toHaveCount(1);
    await breakpoints.getByTestId('edit-debug-breakpoint').click();
    await window.getByTestId('debug-breakpoint-log-message').fill('LOGPOINT i={i}');
    await window.getByTestId('save-debug-breakpoint').click();
    await expect(window.getByTestId('debug-breakpoint-dialog')).toBeHidden();

    await editor.locator('.view-line').filter({ hasText: 'const checkpoint' }).click();
    await window.keyboard.press('F9');
    breakpoints = window.getByTestId('debug-breakpoint-item');
    await expect(breakpoints).toHaveCount(2);
    await breakpoints.nth(1).getByTestId('edit-debug-breakpoint').click();
    await window.getByTestId('debug-breakpoint-condition').fill('i === 3');
    await window.getByTestId('debug-breakpoint-hit-condition').fill('>= 2');
    await window.getByTestId('save-debug-breakpoint').click();
    await window.getByTestId('debug-exception-pause-mode').selectOption('all');
    await window.getByTestId('edit-exception-breakpoints').click();
    await window.getByTestId('exception-break-types').fill('TypeError\nRangeError');
    await window.getByTestId('exception-ignore-types').fill('AbortError');
    await window.getByTestId('save-exception-breakpoints').click();
    await expect(window.getByTestId('exception-breakpoint-dialog')).toBeHidden();
    await expect(window.getByTestId('debug-panel')).toContainText('指定暂停 2 · 忽略 1');

    await expect(breakpoints.nth(0)).toHaveAttribute('data-breakpoint-kind', 'logpoint');
    await expect(breakpoints.nth(1)).toHaveAttribute('data-breakpoint-kind', 'conditional');
    await expect(breakpoints.nth(0)).toContainText('LOGPOINT i={i}');
    await expect(breakpoints.nth(1)).toContainText('i === 3');
    await window.getByTestId('add-function-breakpoint').click();
    await window.getByTestId('special-breakpoint-value').fill('targetFunction');
    await window.getByTestId('save-special-breakpoint').click();
    await window.getByTestId('add-data-breakpoint').click();
    await window.getByTestId('special-breakpoint-value').fill('adapter-owned-data-id');
    await window.getByTestId('data-breakpoint-access-type').selectOption('readWrite');
    await window.getByTestId('save-special-breakpoint').click();
    breakpoints = window.getByTestId('debug-breakpoint-item');
    await expect(breakpoints).toHaveCount(4);
    await expect(
      window.locator('[data-testid="debug-breakpoint-item"][data-breakpoint-kind="function"]'),
    ).toContainText('targetFunction');
    await expect(
      window.locator('[data-testid="debug-breakpoint-item"][data-breakpoint-kind="data"]'),
    ).toContainText('adapter-owned-data-id');
    await expect(access(completedPath)).rejects.toThrow();

    await window.getByTestId('propose-debug').click();
    await window.getByTestId('approve-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已暂停', { timeout: 20_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('program.js:4');
    await expect(window.getByTestId('debug-panel')).toContainText(/i\s*=\s*3/u);
    await expect(window.getByTestId('debug-panel')).toContainText('LOGPOINT i=0');
    await expect(breakpoints.locator('[data-breakpoint-status="verified"]')).toHaveCount(2);
    await expect(
      window.locator('[data-testid="debug-breakpoint-item"][data-breakpoint-kind="function"]'),
    ).toContainText('不支持函数断点');
    await expect(
      window.locator('[data-testid="debug-breakpoint-item"][data-breakpoint-kind="data"]'),
    ).toContainText('不支持数据断点');

    await window.getByTestId('debug-toggle-pause').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已完成', { timeout: 20_000 });
    await expect.poll(() => access(completedPath).then(() => true)).toBe(true);

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await window.getByTestId('toggle-debug').click();
    breakpoints = window.getByTestId('debug-breakpoint-item');
    await expect(breakpoints).toHaveCount(4);
    await expect(window.getByTestId('debug-panel')).toContainText('LOGPOINT i={i}');
    await expect(window.getByTestId('debug-panel')).toContainText('i === 3');
    await expect(window.getByTestId('debug-panel')).toContainText('targetFunction');
    await expect(window.getByTestId('debug-panel')).toContainText('adapter-owned-data-id');
    await expect(window.getByTestId('debug-exception-pause-mode')).toHaveValue('all');
    await expect(window.getByTestId('debug-panel')).toContainText('指定暂停 2 · 忽略 1');
    await window.getByTestId('edit-exception-breakpoints').click();
    await expect(window.getByTestId('exception-break-types')).toHaveValue('TypeError\nRangeError');
    await expect(window.getByTestId('exception-ignore-types')).toHaveValue('AbortError');
  } finally {
    if (application !== undefined) await application.close();
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});
