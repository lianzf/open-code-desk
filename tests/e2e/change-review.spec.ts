import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop } from './desktop-fixture';

const apiKey = 'sk-e2e-change-review';
const proposedContent = '# AI reviewed update\n';

async function readDuringAtomicReplacement(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function startProviderFixture(): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'change-model', owned_by: 'fixture' }] }));
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
        messages?: ReadonlyArray<{ role?: string }>;
      };
      const lastRole = parsed.messages?.at(-1)?.role;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (lastRole === 'tool') {
        response.write(
          'data: {"choices":[{"delta":{"content":"The proposed README update is ready for review."},"finish_reason":"stop"}]}\n\n',
        );
      } else {
        response.write(
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"change-1","function":{"name":"update_file","arguments":"{\\"path\\":\\"README.md\\",\\"content\\":\\"${proposedContent.replaceAll('\n', '\\\\n')}\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
  };
}

test('reviews, applies, persists, and rolls back an Agent file proposal', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-review-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-review-user-'));
  const readmePath = join(projectDirectory, 'README.md');
  const originalContent = '# Original workspace file\n';
  await writeFile(readmePath, originalContent, 'utf8');
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
    await window.getByTestId('provider-name').fill('Change Provider');
    await window.getByTestId('provider-base-url').fill(fixture.baseUrl);
    await window.getByTestId('provider-api-key').fill(apiKey);
    await window.getByTestId('provider-model').fill('change-model');
    await window.getByTestId('save-provider').click();
    await expect(window.getByTestId('test-provider')).toBeVisible();
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await window.getByTestId('chat-input').fill('Update the README through a reviewable change.');
    await window.getByTestId('send-chat').click();

    await expect(window.getByTestId('change-review-dialog')).toBeVisible();
    await expect(window.locator('.monaco-diff-editor')).toBeVisible();
    expect(await readFile(readmePath, 'utf8')).toBe(originalContent);
    await window.getByTestId('approve-change').click();
    await expect(window.getByTestId('apply-approved-changes')).toBeVisible();

    window.once('dialog', (dialog) => void dialog.accept());
    await window.getByTestId('apply-approved-changes').click();
    await expect.poll(() => readDuringAtomicReplacement(readmePath)).toBe(proposedContent);
    await expect(window.getByTestId('rollback-change-set')).toBeVisible();

    window.once('dialog', (dialog) => void dialog.accept());
    await window.getByTestId('rollback-change-set').click();
    await expect.poll(() => readDuringAtomicReplacement(readmePath)).toBe(originalContent);
    await window.getByLabel('关闭变更审核').click();

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    window = await application.firstWindow();
    await window.locator('[data-testid^="recent-workspace-"]').first().click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('open-change-review')).toContainText('已回滚');
    await window.getByTestId('open-change-review').click();
    await expect(window.getByTestId('change-review-dialog')).toContainText('已回滚');
  } finally {
    if (application !== undefined) {
      await application.close();
    }
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
