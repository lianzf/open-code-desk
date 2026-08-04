import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop, removeTestDirectory } from './desktop-fixture';

const execFileAsync = promisify(execFile);
const apiKey = 'sk-e2e-command-context';
const contextMarker = 'E2E_CONTEXT_MARKER_73';
const commandOutput = 'E2E_COMMAND_OUTPUT_91';

async function git(cwd: string, ...args: ReadonlyArray<string>): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function startProviderFixture(): Promise<{
  readonly baseUrl: string;
  readonly server: Server;
  readonly observedBodies: string[];
}> {
  const observedBodies: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'command-model', owned_by: 'fixture' }] }));
      return;
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }

    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      observedBodies.push(body);
      const parsed = JSON.parse(body) as {
        readonly messages?: ReadonlyArray<{ readonly role?: string; readonly content?: string }>;
      };
      const last = parsed.messages?.at(-1);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });

      if (last?.role === 'tool') {
        if (last.content?.includes(commandOutput) !== true) {
          response.end(
            `data: ${JSON.stringify({
              error: { message: 'The Agent did not return the real command output.' },
            })}\n\n`,
          );
          return;
        }
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  content: '已收到批准命令的真实输出，测试闭环完成。',
                },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        response.end('data: [DONE]\n\n');
        return;
      }

      if (
        parsed.messages?.some((message) => message.content?.includes(contextMarker)) !== true ||
        parsed.messages?.some((message) => message.content?.includes('git_diff')) !== true
      ) {
        response.end(
          `data: ${JSON.stringify({
            error: { message: 'Selected context was not included in the model request.' },
          })}\n\n`,
        );
        return;
      }
      const commandArguments = JSON.stringify({
        executable: process.execPath,
        args: [
          '-e',
          `require("node:fs").writeFileSync("command-approved.txt","approved");process.stdout.write("${commandOutput}");setTimeout(()=>process.exit(0),1500);`,
        ],
        timeoutMs: 10_000,
      });
      response.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'e2e-command-call',
                    function: { name: 'run_tests', arguments: commandArguments },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    observedBodies,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
  };
}

test('persists selected context and completes an approved command plus Git workflow', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-command-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-command-user-'));
  const markerPath = join(projectDirectory, 'command-approved.txt');
  await git(projectDirectory, 'init');
  await git(projectDirectory, 'checkout', '-b', 'main');
  await writeFile(join(projectDirectory, 'README.md'), '# Baseline\n', 'utf8');
  await git(projectDirectory, 'add', 'README.md');
  await git(
    projectDirectory,
    '-c',
    'user.name=OpenCode Desk E2E',
    '-c',
    'user.email=e2e@example.invalid',
    'commit',
    '-m',
    'initial',
  );
  await writeFile(join(projectDirectory, 'README.md'), '# Modified for Git context\n', 'utf8');
  await writeFile(join(projectDirectory, 'untracked.txt'), 'untracked\n', 'utf8');
  const fixture = await startProviderFixture();
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

    await window.getByTestId('open-provider-settings').click();
    await window.getByTestId('provider-name').fill('Command Context Provider');
    await window.getByTestId('provider-base-url').fill(fixture.baseUrl);
    await window.getByTestId('provider-api-key').fill(apiKey);
    await window.getByTestId('provider-model').fill('command-model');
    await window.getByTestId('save-provider').click();
    await expect(window.getByTestId('test-provider')).toBeVisible();
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();

    await window.getByTestId('toggle-git').click();
    const gitPanel = window.getByTestId('git-panel');
    await expect(gitPanel.getByText('main', { exact: true })).toBeVisible();
    await expect(gitPanel.getByText('README.md', { exact: true })).toBeVisible();
    await expect(gitPanel.getByText('untracked.txt', { exact: true })).toBeVisible();
    await expect(gitPanel.getByTestId('git-diff')).toContainText('Modified for Git context');
    await window.getByTestId('add-git-diff-context').click();
    await expect(window.getByTestId('context-tray')).toContainText('Git Diff');

    await window.getByTestId('tree-entry-README.md').click();
    await expect(window.locator('.monaco-editor')).toBeVisible();
    await window.getByTestId('add-current-file-context').click();
    await expect(window.getByTestId('context-tray')).toContainText('README.md');

    await window.getByTestId('add-text-context').click();
    await window.getByTestId('text-context-content').fill(contextMarker);
    await window.getByTestId('save-text-context').click();
    await expect(window.getByTestId('context-tray')).toContainText('补充说明');

    await window.getByTestId('toggle-terminal').click();
    await expect(window.getByTestId('terminal-host')).toBeVisible();
    const terminalInput = window.locator('.xterm-helper-textarea');
    await expect(terminalInput).toBeVisible();
    await terminalInput.fill('echo E2E_TERMINAL_CONTEXT');
    await terminalInput.press('Enter');
    await expect(window.locator('.xterm-rows')).toContainText('E2E_TERMINAL_CONTEXT');
    await expect(window.getByTestId('add-terminal-context')).toBeEnabled();
    await window.getByTestId('add-terminal-context').click();
    await expect(window.getByTestId('context-tray')).toContainText('终端');

    await window.getByTestId('chat-input').fill('运行测试并根据真实结果继续。');
    await window.getByTestId('send-chat').click();
    await expect(window.getByTestId('approve-command')).toBeVisible();
    expect(await exists(markerPath)).toBe(false);
    await window.getByTestId('approve-command').click();
    await expect(window.getByTestId('command-running')).toContainText(commandOutput);
    await expect.poll(async () => exists(markerPath)).toBe(true);
    expect(await readFile(markerPath, 'utf8')).toBe('approved');
    await expect(window.getByTestId('chat-messages')).toContainText('测试闭环完成');
    await expect(window.getByTestId('agent-status')).toContainText('已完成');
    await window.getByText(/历史命令（1）/).click();
    await expect(window.getByTestId('command-completed')).toContainText(commandOutput);
    await expect(window.getByTestId('command-completed')).toContainText('退出码：0');
    expect(fixture.observedBodies).toHaveLength(2);

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('context-tray')).toContainText('补充说明');
    await window.getByText(/历史命令（1）/).click();
    await expect(window.getByTestId('command-completed')).toContainText(commandOutput);
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});
