import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop } from './desktop-fixture';

test('sets a real breakpoint, inspects locals, steps, evaluates and restores debug state', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-user-'));
  const heartbeatPath = join(projectDirectory, 'debug-heartbeat.txt');
  await writeFile(
    join(projectDirectory, 'program.js'),
    [
      'function add(left, right) {',
      '  const total = left + right;',
      '  return total;',
      '}',
      'const answer = add(2, 3);',
      'const fs = require("node:fs");',
      'process.stdout.write(`DEBUG_E2E_READY:${answer}\\n`);',
      'setInterval(() => fs.appendFileSync("debug-heartbeat.txt", "x"), 50);',
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
    await window.getByTestId('run-config-name').fill('Node 断点调试');
    await window.getByTestId('run-config-type').selectOption('node');
    await window.getByTestId('run-config-executable').fill(process.execPath);
    await window.getByTestId('run-config-args').fill('program.js');
    await window.getByTestId('save-run-configuration').click();
    await expect(window.getByTestId('run-configuration-select')).not.toHaveValue('');

    await window.getByTestId('tree-entry-program.js').click();
    const editor = window.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await editor.locator('.view-line').filter({ hasText: 'return total;' }).click();
    await window.keyboard.press('F9');
    await window.getByTestId('toggle-debug').click();
    const breakpointItems = window.getByTestId('debug-breakpoint-item');
    await expect.poll(() => breakpointItems.allTextContents()).toEqual(['program.js:3']);
    await expect(breakpointItems.locator('[data-breakpoint-status]')).toHaveAttribute(
      'data-breakpoint-status',
      'pending',
    );

    await window.getByTestId('propose-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('等待批准');
    await expect(access(heartbeatPath)).rejects.toThrow();
    await window.getByTestId('approve-debug').click();
    await expect(breakpointItems.locator('[data-breakpoint-status]')).toHaveAttribute(
      'data-breakpoint-status',
      'verified',
      { timeout: 20_000 },
    );
    try {
      await expect
        .poll(
          async () => {
            const status = await window.getByTestId('debug-status').textContent();
            if (status === '失败') {
              throw new Error(
                `Debug launch failed: ${await window.getByTestId('debug-error').textContent()}`,
              );
            }
            return status;
          },
          { timeout: 20_000 },
        )
        .toBe('已暂停');
    } catch (error) {
      const diagnostics = await window.evaluate(async () => {
        const workspace = await window.openCodeDesk.workspace.getCurrent();
        return workspace === null
          ? []
          : window.openCodeDesk.debug.listHistory({ workspaceId: workspace.id, limit: 5 });
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nDebug history: ${JSON.stringify(diagnostics)}`,
      );
    }
    await expect(window.getByTestId('debug-panel')).toContainText('program.js:3');
    await expect(window.locator('.debug-current-line')).toBeVisible();
    await expect(window.locator('.debug-breakpoint-verified')).toBeVisible();
    await expect(window.getByTestId('debug-panel')).toContainText(/left\s*=\s*2/u);
    await expect(window.getByTestId('debug-panel')).toContainText(/right\s*=\s*3/u);
    await expect(window.getByTestId('debug-panel')).toContainText(/total\s*=\s*5/u);

    await window.getByTestId('debug-watch-input').fill('total');
    await window.getByTestId('debug-watch-input').press('Enter');
    await expect(window.getByTestId('debug-panel')).toContainText('total');
    await window.getByTestId('debug-console-input').fill('left + right');
    await window.getByTestId('debug-console-input').press('Enter');
    await expect(window.getByTestId('debug-panel')).toContainText('> left + right');

    await window.getByTestId('debug-next').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已暂停', { timeout: 10_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('program.js:6');
    await window.getByTestId('debug-toggle-pause').click();
    await expect(window.getByTestId('debug-panel')).toContainText('DEBUG_E2E_READY:5');
    await expect.poll(async () => readFile(heartbeatPath, 'utf8').catch(() => '')).not.toBe('');

    await window.getByTestId('stop-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已停止');
    const heartbeatAfterStop = await readFile(heartbeatPath, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readFile(heartbeatPath, 'utf8')).toBe(heartbeatAfterStop);

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('run-configuration-select')).toContainText('Node 断点调试');
    await window.getByTestId('toggle-debug').click();
    await expect(window.getByTestId('debug-breakpoint-item')).toContainText('program.js:3');
  } finally {
    if (application !== undefined) await application.close();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
