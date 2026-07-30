import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function launchDesktop(userDataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      join(process.cwd(), 'apps/desktop/out/main/main.js'),
      `--user-data-dir=${userDataDirectory}`,
    ],
  });
}

test('launches the secure desktop shell and reaches the main process', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-user-'));
  const application = await launchDesktop(userDataDirectory);

  try {
    const window = await application.firstWindow();

    await expect(window).toHaveTitle('OpenCode Desk');
    await expect(window.getByTestId('app-shell')).toBeVisible();
    await expect(window.getByTestId('health-status')).toContainText('主进程连接正常');

    const securityPreferences = await application.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];

      if (mainWindow === undefined) {
        throw new Error('Main window was not created.');
      }

      return mainWindow.webContents.getLastWebPreferences();
    });

    expect(securityPreferences.contextIsolation).toBe(true);
    expect(securityPreferences.nodeIntegration).toBe(false);
    expect(securityPreferences.sandbox).toBe(true);
  } finally {
    await application.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('opens, edits, saves, and restores a recent workspace', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-user-'));
  const readmePath = join(projectDirectory, 'README.md');
  await writeFile(readmePath, '# Original\n', 'utf8');

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
    await expect(window.getByTestId('workspace-name')).toHaveText(
      projectDirectory.split(/[\\/]/).at(-1) ?? '',
    );
    await expect(window.getByTestId('tree-entry-README.md')).toBeVisible();

    await window.getByTestId('tree-entry-README.md').click();
    const monaco = window.locator('.monaco-editor').first();
    await expect(monaco).toBeVisible();
    await monaco.click();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('# Updated from desktop\n');
    await window.keyboard.press('Control+S');

    await expect.poll(async () => readFile(readmePath, 'utf8')).toBe('# Updated from desktop\n');

    await writeFile(readmePath, '# Externally updated\n', 'utf8');
    await expect(window.locator('.monaco-editor .view-lines')).toContainText(
      '# Externally updated',
    );

    await application.close();
    application = undefined;

    application = await launchDesktop(userDataDirectory);
    const restoredWindow = await application.firstWindow();
    await expect(restoredWindow.getByText(projectDirectory, { exact: true })).toBeVisible();
    await restoredWindow.getByText(projectDirectory, { exact: true }).click();
    await expect(restoredWindow.getByTestId('workspace-page')).toBeVisible();
    await expect(restoredWindow.getByTestId('tree-entry-README.md')).toBeVisible();
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('manages workspace paths and performs cancellable source-text search', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-files-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-user-'));
  await writeFile(join(projectDirectory, 'README.md'), '# Project\n', 'utf8');

  const application = await launchDesktop(userDataDirectory);
  try {
    await application.evaluate(({ dialog }, selectedDirectory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedDirectory] }),
      });
    }, projectDirectory);
    const window = await application.firstWindow();
    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();

    await window.evaluate(() => {
      window.prompt = () => 'docs';
    });
    await window.getByTestId('create-directory').click();
    await expect(window.getByTestId('tree-entry-docs')).toBeVisible();

    await window.evaluate(() => {
      window.prompt = () => 'docs/notes.md';
    });
    await window.getByTestId('create-file').click();
    const monaco = window.locator('.monaco-editor').first();
    await expect(monaco).toBeVisible();
    await monaco.click();
    await window.keyboard.type('A uniquely searchable phrase\n');
    await window.keyboard.press('Control+S');
    await expect
      .poll(async () => readFile(join(projectDirectory, 'docs', 'notes.md'), 'utf8'))
      .toContain('uniquely searchable');

    await window.getByTestId('toggle-search-mode').click();
    await window.getByTestId('file-search').fill('uniquely searchable');
    await window.getByTestId('file-search').press('Enter');
    await expect(window.getByText('docs/notes.md:1:3', { exact: true })).toBeVisible();

    await window.getByTestId('file-search').fill('');
    await window.getByTestId('file-search').press('Enter');
    await window.getByTestId('tree-entry-docs').click();
    await expect(window.getByTestId('tree-entry-docs/notes.md')).toBeVisible();
    await window.getByTestId('tree-entry-docs/notes.md').hover();
    await window.evaluate(() => {
      window.prompt = () => 'notes-renamed.md';
    });
    await window.getByTestId('move-path-docs/notes.md').click();
    await expect(window.getByTestId('tree-entry-notes-renamed.md')).toBeVisible();

    await window.getByTestId('tree-entry-notes-renamed.md').hover();
    await window.evaluate(() => {
      window.confirm = () => true;
    });
    await window.getByTestId('delete-path-notes-renamed.md').click();
    await expect(window.getByTestId('tree-entry-notes-renamed.md')).toHaveCount(0);

    await window.getByTestId('tree-entry-docs').hover();
    await window.getByTestId('delete-path-docs').click();
    await expect(window.getByTestId('tree-entry-docs')).toHaveCount(0);

    await window.getByTestId('toggle-audit').click();
    await expect(window.getByTestId('audit-panel')).toBeVisible();
    await expect(window.getByText('path.delete', { exact: true }).first()).toBeVisible();
  } finally {
    await application.close();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
