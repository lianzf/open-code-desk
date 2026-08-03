import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { launchDesktop } from './desktop-fixture';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createTask(
  window: Page,
  input: {
    readonly name: string;
    readonly type: string;
    readonly source: string;
    readonly dependencyName?: string;
  },
): Promise<void> {
  await window.getByTestId('new-project-task').click();
  const dialog = window.getByTestId('project-task-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('project-task-name').fill(input.name);
  await dialog.getByTestId('project-task-type').selectOption(input.type);
  await dialog.getByTestId('project-task-executable').fill(process.execPath);
  await dialog.getByTestId('project-task-args').fill(`-e\n${input.source}`);
  if (input.dependencyName !== undefined) {
    await dialog.locator('label', { hasText: input.dependencyName }).getByRole('checkbox').check();
  }
  await dialog.getByTestId('save-project-task').click();
  await expect(dialog).not.toBeVisible();
}

test('creates a dependency task plan, approves it, and restores its history', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-task-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-task-user-'));
  const orderPath = join(projectDirectory, 'task-order.txt');
  let application: ElectronApplication | undefined;
  let resizedPanelHeight = 0;
  let resizedSidebarWidth = 0;
  let resizedChatWidth = 0;

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
    const initialSidebarBox = await window.getByTestId('sidebar-panel').boundingBox();
    const sidebarResizerBox = await window.getByTestId('sidebar-resizer').boundingBox();
    const initialChatBox = await window.getByTestId('chat-panel-container').boundingBox();
    const chatResizerBox = await window.getByTestId('chat-panel-resizer').boundingBox();
    if (
      initialSidebarBox === null ||
      sidebarResizerBox === null ||
      initialChatBox === null ||
      chatResizerBox === null
    ) {
      throw new Error('工作台水平面板无法测量。');
    }
    await window.mouse.move(
      sidebarResizerBox.x + sidebarResizerBox.width / 2,
      sidebarResizerBox.y + 60,
    );
    await window.mouse.down();
    await window.mouse.move(sidebarResizerBox.x + 56, sidebarResizerBox.y + 60);
    await window.mouse.up();
    await window.mouse.move(chatResizerBox.x + chatResizerBox.width / 2, chatResizerBox.y + 60);
    await window.mouse.down();
    await window.mouse.move(chatResizerBox.x - 56, chatResizerBox.y + 60);
    await window.mouse.up();
    await expect
      .poll(async () => (await window.getByTestId('sidebar-panel').boundingBox())?.width)
      .toBeGreaterThan(initialSidebarBox.width + 30);
    await expect
      .poll(async () => (await window.getByTestId('chat-panel-container').boundingBox())?.width)
      .toBeGreaterThan(initialChatBox.width + 30);
    resizedSidebarWidth = (await window.getByTestId('sidebar-panel').boundingBox())?.width ?? 0;
    resizedChatWidth = (await window.getByTestId('chat-panel-container').boundingBox())?.width ?? 0;
    await window.getByTestId('toggle-project-tasks').click();
    await expect(window.getByTestId('project-tasks-panel')).toBeVisible();
    const initialPanelBox = await window.getByTestId('bottom-panel-container').boundingBox();
    const resizerBox = await window.getByTestId('bottom-panel-resizer').boundingBox();
    if (initialPanelBox === null || resizerBox === null) throw new Error('底部面板无法测量。');
    await window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 2);
    await window.mouse.down();
    await window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y - 64);
    await window.mouse.up();
    await expect
      .poll(async () => (await window.getByTestId('bottom-panel-container').boundingBox())?.height)
      .toBeGreaterThan(initialPanelBox.height + 40);
    resizedPanelHeight =
      (await window.getByTestId('bottom-panel-container').boundingBox())?.height ?? 0;

    await createTask(window, {
      name: 'prepare',
      type: 'build',
      source:
        'require("node:fs").appendFileSync("task-order.txt", "prepare\\n"); process.stdout.write("TASK_PREPARED\\n");',
    });
    await createTask(window, {
      name: 'verify',
      type: 'test',
      dependencyName: 'prepare',
      source:
        'require("node:fs").appendFileSync("task-order.txt", "verify\\n"); process.stdout.write("TASK_E2E_READY\\n");',
    });

    await expect(window.getByTestId('project-task-select')).toHaveValue(/.+/u);
    await window.getByTestId('propose-project-task').click();
    await expect(window.getByTestId('approve-project-task')).toBeVisible();
    await expect(window.getByTestId('project-tasks-panel')).toContainText('1. prepare');
    await expect(window.getByTestId('project-tasks-panel')).toContainText('2. verify');
    expect(await exists(orderPath)).toBe(false);

    await window.getByTestId('approve-project-task').click();
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const workspace = await window.openCodeDesk.workspace.getCurrent();
            if (workspace === null) return { status: 'missing-workspace' };
            const history = await window.openCodeDesk.projectTasks.listHistory({
              workspaceId: workspace.id,
              limit: 5,
            });
            const latest = history[0];
            return {
              status: latest?.status,
              errorCode: latest?.error?.code,
              errorMessage: latest?.error?.message,
            };
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ status: 'completed' });
    await expect(window.getByTestId('project-task-output')).toContainText('TASK_PREPARED');
    await expect(window.getByTestId('project-task-output')).toContainText('TASK_E2E_READY');
    await expect(window.getByTestId('project-task-history-select')).toContainText('已完成');
    expect(await readFile(orderPath, 'utf8')).toBe('prepare\nverify\n');

    await window.getByTestId('toggle-project-tasks').click();
    await window.getByTestId('open-run-configuration').click();
    const runDialog = window.getByTestId('run-configuration-dialog');
    await runDialog.getByTestId('run-config-name').fill('hooked run');
    await runDialog.getByTestId('run-config-type').selectOption('node');
    await runDialog.getByTestId('run-config-executable').fill(process.execPath);
    await runDialog.getByTestId('run-config-runtime-args').fill('-e');
    await runDialog
      .getByTestId('run-config-args')
      .fill(
        'require("node:fs").appendFileSync("task-order.txt", "main\\n"); process.stdout.write("RUN_HOOK_MAIN\\n");',
      );
    await runDialog
      .getByTestId('run-config-pre-launch-task')
      .selectOption({ label: 'prepare · build' });
    await runDialog
      .getByTestId('run-config-post-run-task')
      .selectOption({ label: 'verify · test' });
    await runDialog.getByTestId('save-run-configuration').click();
    await expect(runDialog).not.toBeVisible();
    await window.getByTestId('open-run-configuration').click();
    await window.getByTestId('duplicate-run-configuration').click();
    await expect(runDialog).toContainText('hooked run 副本');
    await runDialog.getByRole('button', { name: '关闭运行配置' }).click();
    await window.getByTestId('propose-run').click();
    const runOutputPanel = window.getByTestId('run-output-panel');
    await expect(runOutputPanel).toContainText('启动前任务');
    await expect(runOutputPanel).toContainText('启动后任务');
    await window.getByTestId('approve-run').click();
    await expect(window.getByTestId('run-output')).toContainText('RUN_HOOK_MAIN');
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const workspace = await window.openCodeDesk.workspace.getCurrent();
            if (workspace === null) return undefined;
            return (
              await window.openCodeDesk.run.listHistory({ workspaceId: workspace.id, limit: 1 })
            ).at(0)?.status;
          }),
        { timeout: 15_000 },
      )
      .toBe('completed');
    expect(await readFile(orderPath, 'utf8')).toBe(
      'prepare\nverify\nprepare\nmain\nprepare\nverify\n',
    );

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect
      .poll(async () => (await window.getByTestId('sidebar-panel').boundingBox())?.width)
      .toBeCloseTo(resizedSidebarWidth, 0);
    await expect
      .poll(async () => (await window.getByTestId('chat-panel-container').boundingBox())?.width)
      .toBeCloseTo(resizedChatWidth, 0);
    await window.getByTestId('toggle-project-tasks').click();
    await expect
      .poll(async () => (await window.getByTestId('bottom-panel-container').boundingBox())?.height)
      .toBeCloseTo(resizedPanelHeight, 0);
    await expect(window.getByTestId('project-task-select')).toContainText('verify');
    await expect(window.getByTestId('project-task-history-select')).toContainText('已完成');
    await expect(window.getByTestId('project-task-output')).toContainText('TASK_E2E_READY');
  } finally {
    if (application !== undefined) await application.close();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
