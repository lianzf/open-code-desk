import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchDesktop, removeTestDirectory } from './desktop-fixture';

test('launches the secure desktop shell and reaches the main process', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-user-'));
  const application = await launchDesktop(userDataDirectory);

  try {
    const requestedPasswordStore = process.env.OPEN_CODE_DESK_E2E_PASSWORD_STORE;
    if (process.platform === 'linux' && requestedPasswordStore !== undefined) {
      const selectedPasswordStore = await application.evaluate(({ safeStorage }) =>
        safeStorage.getSelectedStorageBackend(),
      );
      expect(selectedPasswordStore).toBe('gnome_libsecret');
    }

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
    await removeTestDirectory(userDataDirectory);
  }
});

test('retains the main window when the main-process garbage collector runs', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-gc-user-'));
  const application = await launchDesktop(userDataDirectory, { exposeGarbageCollector: true });

  try {
    const window = await application.firstWindow();
    await expect(window.getByTestId('app-shell')).toBeVisible();

    const garbageCollectorWasExposed = await application.evaluate(() => {
      const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      collectGarbage?.();
      return collectGarbage !== undefined;
    });

    expect(garbageCollectorWasExposed).toBe(true);
    await expect(window.getByTestId('app-shell')).toBeVisible();
    expect(application.windows()).toHaveLength(1);
  } finally {
    await application.close();
    await removeTestDirectory(userDataDirectory);
  }
});

test('persists appearance, locale, updater state, and configurable shortcuts', async () => {
  const isPackagedRun = process.env.OPEN_CODE_DESK_E2E_EXECUTABLE_PATH !== undefined;
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-settings-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-settings-user-'));
  await writeFile(join(projectDirectory, 'README.md'), '# Settings fixture\n', 'utf8');
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

    await window.getByTestId('open-app-settings').click();
    await expect(window.getByTestId('app-settings-dialog')).toBeVisible();
    await expect(
      isPackagedRun
        ? window.getByText(/^当前版本\s+\S+/)
        : window.getByText('开发环境不执行更新检查'),
    ).toBeVisible();
    await expect(window.getByText('尚无崩溃报告')).toBeVisible();
    await window.getByTestId('theme-select').selectOption('light');
    await window.getByTestId('locale-select').selectOption('en-US');
    await window.getByTestId('shortcut-toggleGit').fill('Ctrl+Shift+J');
    await window.getByTestId('save-app-settings').click();

    await expect(window.getByTestId('open-project')).toContainText('Open local project');
    expect(await window.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByText('AI coding assistant')).toBeVisible();
    await expect(window.getByTestId('file-search')).toHaveAttribute(
      'placeholder',
      'Search file names',
    );
    await expect(window.getByTestId('new-conversation')).toHaveAttribute(
      'aria-label',
      'New conversation',
    );
    await expect(window.getByTestId('run-toolbar')).toContainText('Compound');
    await expect(window.getByTestId('toggle-project-tasks')).toContainText('Tasks');
    await expect(window.getByTestId('toggle-terminal')).toContainText('Terminal');
    await expect(window.getByTestId('toggle-audit')).toContainText('Audit');
    await window.getByTestId('open-run-configuration').click();
    await expect(window.getByTestId('run-configuration-dialog')).toContainText(
      'New run configuration',
    );
    await window.getByLabel('Close run configuration').click();
    await window.getByTestId('toggle-project-tasks').click();
    await expect(window.getByTestId('project-tasks-panel')).toContainText('Project tasks');
    await expect(window.getByTestId('project-tasks-panel')).toContainText('No tasks');
    await window.getByTestId('toggle-audit').click();
    await expect(window.getByTestId('audit-panel')).toContainText('Audit log');
    await window.getByLabel('Model settings').click();
    await expect(window.getByTestId('provider-settings')).toContainText('Model services');
    await expect(window.getByText('Keys are protected locally on this device')).toBeVisible();
    await window.getByLabel('Close model settings').click();
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+J' : 'Control+Shift+J');
    await expect(window.getByTestId('git-panel')).toBeVisible();
    await expect(window.getByTestId('git-panel')).toContainText(
      'The current workspace is not a Git repository',
    );

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.getByTestId('open-app-settings').click();
    await expect(window.getByTestId('theme-select')).toHaveValue('light');
    await expect(window.getByTestId('locale-select')).toHaveValue('en-US');
    await expect(window.getByTestId('shortcut-toggleGit')).toHaveValue('Ctrl+Shift+J');
    await expect(
      isPackagedRun
        ? window.getByText(/^Current version\s+\S+/)
        : window.getByText('Update checks are disabled in development'),
    ).toBeVisible();
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
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
    const editorLines = monaco.locator('.view-lines');
    await expect(monaco).toBeVisible();
    await expect(editorLines).toContainText('# Original');
    await monaco.click();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('# Updated from desktop\n');
    await expect(editorLines).toContainText('# Updated from desktop');
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
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
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
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});

test('persists read approvals, blocked paths, and explicit external directory grants', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-permissions-'));
  const externalDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-external-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-e2e-user-'));
  await writeFile(join(projectDirectory, 'README.md'), '# Permission fixture\n', 'utf8');
  let application: ElectronApplication | undefined;

  try {
    application = await launchDesktop(userDataDirectory);
    await application.evaluate(
      ({ dialog }, selectedDirectories) => {
        const pending = [...selectedDirectories];
        Object.defineProperty(dialog, 'showOpenDialog', {
          configurable: true,
          value: async () => {
            const selected = pending.shift();
            return selected === undefined
              ? { canceled: true, filePaths: [] }
              : { canceled: false, filePaths: [selected] };
          },
        });
      },
      [projectDirectory, externalDirectory],
    );
    let window = await application.firstWindow();
    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByText('工作区权限规则', { exact: true }).click();

    const autoAllow = window.getByTestId('auto-allow-read-tools');
    await expect(autoAllow).toBeChecked();
    await autoAllow.uncheck();
    const blockedPath = window.getByLabel('禁止访问的相对路径');
    await blockedPath.fill('private');
    await blockedPath.locator('..').getByRole('button', { name: '添加' }).click();
    await expect(window.getByText('private', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: '选择目录' }).click();
    await expect(window.getByText(externalDirectory, { exact: true })).toBeVisible();

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.getByText(projectDirectory, { exact: true }).click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByText('工作区权限规则', { exact: true }).click();
    await expect(window.getByTestId('auto-allow-read-tools')).not.toBeChecked();
    await expect(window.getByText('private', { exact: true })).toBeVisible();
    await expect(window.getByText(externalDirectory, { exact: true })).toBeVisible();
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(externalDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});
