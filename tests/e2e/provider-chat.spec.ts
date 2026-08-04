import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop, removeTestDirectory } from './desktop-fixture';

const secretSentinel = 'e2e-secret-sentinel-must-not-persist';
const workspaceSentinel = 'E2E_WORKSPACE_SENTINEL_42';

interface FixtureMessage {
  readonly role?: string;
  readonly content?: string;
}

async function startProviderFixture(): Promise<{
  readonly baseUrl: string;
  readonly server: Server;
}> {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${secretSentinel}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'e2e-model', owned_by: 'fixture' }] }));
      return;
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }

    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      requestBody += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(requestBody) as {
        readonly model?: string;
        readonly messages?: ReadonlyArray<FixtureMessage>;
      };
      if (parsed.model !== 'e2e-model') {
        response.writeHead(404).end();
        return;
      }
      const lastMessage = parsed.messages?.at(-1);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });

      if (lastMessage?.content?.includes('停止') === true) {
        response.write(
          'data: {"id":"e2e-slow","choices":[{"delta":{"content":"长任务已开始"}}]}\n\n',
        );
        const timer = setTimeout(() => {
          if (!response.destroyed) {
            response.end(
              'data: {"id":"e2e-slow","choices":[{"delta":{"content":"不应到达"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            );
          }
        }, 10_000);
        response.on('close', () => clearTimeout(timer));
        return;
      }

      if (lastMessage?.role === 'tool') {
        if (lastMessage.content?.includes(workspaceSentinel) !== true) {
          response.writeHead(500).end();
          return;
        }
        response.write(
          'data: {"id":"e2e-final","choices":[{"delta":{"content":"已读取真实工作区文件。\\n\\n```ts\\nconst answer = 42;\\n```"},"finish_reason":"stop"}],"usage":{"prompt_tokens":23,"completion_tokens":11}}\n\n',
        );
        response.end('data: [DONE]\n\n');
        return;
      }

      response.write(
        'data: {"id":"e2e-tool","choices":[{"delta":{"tool_calls":[{"index":0,"id":"e2e-read-1","function":{"name":"read_"}}]}}]}\n\n',
      );
      response.write(
        'data: {"id":"e2e-tool","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      );
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
}

test('runs a real read-tool Agent loop and restores the conversation after restart', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-chat-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-chat-user-'));
  await writeFile(join(projectDirectory, 'README.md'), `# ${workspaceSentinel}\n`, 'utf8');
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
    const providerKind = window.getByTestId('provider-kind');
    await expect(providerKind.locator('option')).toHaveCount(10);
    await providerKind.selectOption('anthropic');
    await expect(window.getByTestId('provider-base-url')).toHaveValue(
      'https://api.anthropic.com/v1',
    );
    await providerKind.selectOption('gemini');
    await expect(window.getByTestId('provider-base-url')).toHaveValue(
      'https://generativelanguage.googleapis.com/v1beta',
    );
    await providerKind.selectOption('openai-compatible');
    await window.getByTestId('provider-name').fill('E2E Provider');
    await window.getByTestId('provider-base-url').fill(fixture.baseUrl);
    await window.getByTestId('provider-api-key').fill(secretSentinel);
    await window.getByTestId('provider-model').fill('e2e-model');
    await window.getByTestId('save-provider').click();

    await expect(window.getByTestId('test-provider')).toBeVisible();
    await expect(window.getByTestId('provider-api-key')).toHaveValue('');
    await window.getByTestId('test-provider').click();
    await expect(window.getByTestId('provider-test-result')).toContainText('1');
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('conversation-select')).not.toHaveValue('');
    await window.getByTestId('chat-input').fill('请读取 README 并给出 TypeScript 示例');
    await window.getByTestId('send-chat').click();

    await expect(window.getByTestId('tool-activity')).toContainText('read_file');
    await expect(window.getByTestId('tool-activity')).toContainText('完成');
    await expect(window.getByTestId('chat-messages')).toContainText('已读取真实工作区文件');
    await expect(window.getByTestId('chat-messages').locator('code')).toContainText(
      'const answer = 42;',
    );
    await expect(window.getByTestId('context-stats')).toBeVisible();
    await expect(window.getByTestId('agent-status')).toContainText('已完成');
    await expect(window.getByTestId('task-plan')).toBeVisible();
    await window.getByTestId('task-plan').locator('summary').click();
    await expect(window.getByTestId('task-plan')).toContainText('执行工具 read_file');

    await window.getByRole('button', { name: '重试', exact: true }).click();
    await expect(window.getByTestId('chat-messages')).toContainText('已读取真实工作区文件');
    await expect(window.getByTestId('agent-status')).toContainText('已完成');

    const actualUserData = await application.evaluate(({ app }) => app.getPath('userData'));
    const databaseFiles = (await readdir(actualUserData)).filter((name) =>
      name.startsWith('open-code-desk.sqlite'),
    );
    expect(databaseFiles.length).toBeGreaterThan(0);
    for (const databaseFile of databaseFiles) {
      const bytes = await readFile(join(actualUserData, databaseFile));
      expect(bytes.includes(Buffer.from(secretSentinel))).toBe(false);
    }

    await window.getByTestId('chat-input').fill('测试停止生成');
    await window.getByTestId('send-chat').click();
    await expect(window.getByTestId('chat-messages')).toContainText('长任务已开始');
    await window.getByTestId('stop-chat').click();
    await expect(window.getByTestId('chat-messages')).toContainText('已停止生成');

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('chat-messages')).toContainText('已读取真实工作区文件');
    const restoredToolActivities = window.getByTestId('tool-activity');
    await expect(restoredToolActivities).toHaveCount(2);
    await expect(restoredToolActivities).toContainText(['read_file', 'read_file']);

    const renamedConversation = '已恢复的 E2E 编程任务';
    await window.evaluate((title) => {
      window.prompt = () => title;
    }, renamedConversation);
    await window.getByLabel('重命名会话').click();
    await expect(window.getByTestId('conversation-select')).toContainText(renamedConversation);

    await window.getByTestId('conversation-search').fill(renamedConversation);
    await window.getByTestId('conversation-search').press('Enter');
    await expect(window.getByTestId('conversation-select').locator('option')).toHaveCount(1);

    const exportPath = join(projectDirectory, 'restored-conversation.md');
    await application.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath: selectedPath }),
      });
    }, exportPath);
    await window.getByLabel('导出 Markdown').click();
    await expect.poll(async () => readFile(exportPath, 'utf8')).toContain(renamedConversation);
    await expect.poll(async () => readFile(exportPath, 'utf8')).toContain('read_file');

    await window.getByLabel('模型设置').click();
    await window.getByRole('button', { name: /E2E Provider e2e-model/ }).click();
    await expect(window.getByTestId('provider-api-key')).toHaveValue('');
    await window.getByTestId('test-provider').click();
    await expect(window.getByTestId('provider-test-result')).toContainText('1');
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.evaluate(() => {
      window.confirm = () => true;
    });
    await window.getByLabel('删除会话').click();
    await expect(window.getByTestId('conversation-select')).not.toContainText(renamedConversation);
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});
