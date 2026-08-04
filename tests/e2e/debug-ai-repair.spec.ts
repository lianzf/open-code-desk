import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop, removeTestDirectory } from './desktop-fixture';

const apiKey = 'sk-e2e-debug-ai-provider';
const runtimeSecret = 'E2E_RUNTIME_PASSWORD_MUST_NOT_REACH_MODEL';
const originalProgram = [
  'function calculate() {',
  '  const password = process.env.DEBUG_PASSWORD;',
  '  process.stderr.write(`diagnostic password=${password}\\n`);',
  '  throw new Error(`calculation failed password=${password}`);',
  '}',
  'calculate();',
].join('\n');
const repairedProgram = [
  'function calculate() {',
  '  return 42;',
  '}',
  'process.stdout.write(`FIXED:${calculate()}\\n`);',
].join('\n');

async function readDuringAtomicReplacement(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function startProviderFixture(): Promise<{
  readonly baseUrl: string;
  readonly server: Server;
  readonly diagnostics: { requestCount: number; receivedDebugContext: boolean; leaked: boolean };
}> {
  const diagnostics = { requestCount: 0, receivedDebugContext: false, leaked: false };
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'debug-repair-model', owned_by: 'fixture' }] }));
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
      diagnostics.leaked ||= body.includes(runtimeSecret);
      diagnostics.receivedDebugContext ||= body.includes('用户审核的调试上下文');
      diagnostics.requestCount += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (diagnostics.requestCount === 1) {
        response.write(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"debug-read-1","function":{"name":"read_file","arguments":"{\\"path\\":\\"program.js\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        );
      } else if (diagnostics.requestCount === 2) {
        const arguments_ = JSON.stringify({ path: 'program.js', content: repairedProgram });
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'debug-update-1', function: { name: 'update_file', arguments: arguments_ } }] }, finish_reason: 'tool_calls' }] })}\n\n`,
        );
      } else {
        response.write(
          'data: {"choices":[{"delta":{"content":"已定位异常并生成修复 Diff；请审核后手动重新调试验证。"},"finish_reason":"stop"}]}\n\n',
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    diagnostics,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
  };
}

test('redacts a real exception, lets AI propose a Diff, and re-debugs only after user action', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-ai-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-ai-user-'));
  const programPath = join(projectDirectory, 'program.js');
  await writeFile(programPath, originalProgram, 'utf8');
  await writeFile(join(projectDirectory, 'package.json'), '{"name":"debug-ai-fixture"}', 'utf8');
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
    const window = await application.firstWindow();

    await window.getByTestId('open-provider-settings').click();
    await window.getByTestId('provider-name').fill('Debug AI Provider');
    await window.getByTestId('provider-base-url').fill(fixture.baseUrl);
    await window.getByTestId('provider-api-key').fill(apiKey);
    await window.getByTestId('provider-model').fill('debug-repair-model');
    await window.getByTestId('save-provider').click();
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByTestId('open-run-configuration').click();
    const configurationDialog = window.getByTestId('run-configuration-dialog');
    await window.getByTestId('run-config-name').fill('异常修复调试');
    await window.getByTestId('run-config-type').selectOption('node');
    await window.getByTestId('run-config-executable').fill(process.execPath);
    await window.getByTestId('run-config-args').fill('program.js');
    await configurationDialog.getByRole('button', { name: '添加' }).click();
    await configurationDialog.getByLabel('环境变量 1 名称').fill('DEBUG_PASSWORD');
    await configurationDialog.getByText('敏感', { exact: true }).click();
    await configurationDialog.getByLabel('环境变量 1 值').fill(runtimeSecret);
    await window.getByTestId('save-run-configuration').click();

    await window.getByTestId('toggle-debug').click();
    await window.getByTestId('propose-debug').click();
    await window.getByTestId('approve-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已暂停', { timeout: 20_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('calculation failed');

    await window.getByTestId('debug-ask-ai').click();
    const contextDialog = window.getByTestId('debug-context-dialog');
    await expect(contextDialog).toBeVisible();
    await expect(contextDialog).not.toContainText(runtimeSecret);
    await expect(window.getByTestId('debug-context-redactions')).not.toContainText('0 处脱敏');
    await window.getByTestId('debug-context-confirm').click();

    await expect(window.getByTestId('change-review-dialog')).toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.monaco-diff-editor')).toBeVisible();
    expect(await readFile(programPath, 'utf8')).toBe(originalProgram);
    expect(fixture.diagnostics.receivedDebugContext).toBe(true);
    expect(fixture.diagnostics.leaked).toBe(false);

    await window.getByTestId('approve-change').click();
    window.once('dialog', (dialog) => void dialog.accept());
    await window.getByTestId('apply-approved-changes').click();
    await expect.poll(() => readDuringAtomicReplacement(programPath)).toBe(repairedProgram);
    await window.getByLabel('关闭变更审核').click();

    await expect(window.getByTestId('debug-status')).toHaveText('已暂停');
    await window.getByTestId('restart-debug').click();
    await expect(window.getByTestId('debug-status')).toHaveText('已完成', { timeout: 20_000 });
    await expect(window.getByTestId('debug-panel')).toContainText('FIXED:42');
    await expect(window.getByTestId('debug-panel')).not.toContainText(runtimeSecret);
  } finally {
    if (application !== undefined) await application.close();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    await removeTestDirectory(projectDirectory);
    await removeTestDirectory(userDataDirectory);
  }
});
