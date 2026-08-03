import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchDesktop } from '../e2e/desktop-fixture';

const apiKey = 'stability-acceptance-secret';
const conversationCount = 20;
const durationMinutes = Number(process.env.OPEN_CODE_DESK_STABILITY_MINUTES ?? '0');

interface MemorySample {
  readonly at: string;
  readonly heapUsed: number;
  readonly rss: number;
}

test('survives 20 conversations, repeated model switches, restart, and the configured soak', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-stability-project-'));
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-stability-user-'));
  await writeFile(join(projectDirectory, 'README.md'), '# Stability acceptance\n', 'utf8');
  const fixture = await startProviderFixture();
  let application: ElectronApplication | undefined;

  try {
    application = await launchDesktop(userDataDirectory, { exposeGarbageCollector: true });
    attachLifecycleDiagnostics(application);
    await installNativeLifecycleDiagnostics(application);
    await application.evaluate(({ dialog }, selectedDirectory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedDirectory] }),
      });
    }, projectDirectory);
    let window = await application.firstWindow();
    attachWindowDiagnostics(window);

    await window.getByTestId('open-provider-settings').click();
    await window.getByTestId('provider-name').fill('Stability Provider');
    await window.getByTestId('provider-base-url').fill(fixture.baseUrl);
    await window.getByTestId('provider-api-key').fill(apiKey);
    await window.getByTestId('provider-model').fill('stability-model-a');
    await window.getByLabel('快速模型（可选）').fill('stability-model-b');
    await window.getByTestId('save-provider').click();
    await expect(window.getByTestId('test-provider')).toBeVisible();
    await window.getByTestId('test-provider').click();
    await expect(window.getByTestId('provider-test-result')).toContainText('2');
    await window.getByTestId('provider-settings').locator('header button').click();

    await window.getByTestId('open-project').click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    const initialMemory = await memorySample(application);
    const samples: MemorySample[] = [initialMemory];

    for (let index = 0; index < conversationCount; index += 1) {
      if (index > 0) await window.getByTestId('new-conversation').click();
      const model = index % 2 === 0 ? 'stability-model-a' : 'stability-model-b';
      await window.getByLabel('选择模型', { exact: true }).selectOption(model);
      const prompt = `稳定性会话 ${index + 1}`;
      await window.getByTestId('chat-input').fill(prompt);
      await window.getByTestId('send-chat').click();
      await expect(window.getByTestId('chat-messages')).toContainText(`稳定回复：${prompt}`);
      await expect(window.getByTestId('agent-status')).toContainText('已完成');
    }

    await expect(window.getByTestId('conversation-select').locator('option')).toHaveCount(
      conversationCount,
    );
    samples.push(await memorySample(application));
    await forceMainProcessGarbageCollection(application);
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await hideWindowDuringSoak(application);

    const soakDeadline = Date.now() + durationMinutes * 60_000;
    let soakIteration = 0;
    let nextSampleAt = Date.now() + 60_000;
    while (Date.now() < soakDeadline) {
      const conversationIndex = soakIteration % conversationCount;
      await window.getByTestId('conversation-select').selectOption({ index: conversationIndex });
      await window
        .getByLabel('选择模型', { exact: true })
        .selectOption(soakIteration % 2 === 0 ? 'stability-model-a' : 'stability-model-b');
      await expect(window.getByTestId('workspace-page')).toBeVisible();
      if (Date.now() >= nextSampleAt) {
        const sample = await memorySample(application);
        samples.push(sample);
        await forceMainProcessGarbageCollection(application);
        if (samples.length % 10 === 0) {
          console.info(
            `STABILITY_HEARTBEAT ${JSON.stringify({ soakIteration, samples: samples.length, ...sample })}`,
          );
        }
        nextSampleAt += 60_000;
      }
      soakIteration += 1;
      await delay(1_000);
    }
    samples.push(await memorySample(application));

    const finalMemory = samples.at(-1) ?? initialMemory;
    const maximumHeap = Math.max(...samples.map((sample) => sample.heapUsed));
    const maximumRss = Math.max(...samples.map((sample) => sample.rss));
    const result = {
      durationMinutes,
      conversationCount,
      soakIterations: soakIteration,
      memorySamples: samples.length,
      initialHeapBytes: initialMemory.heapUsed,
      finalHeapBytes: finalMemory.heapUsed,
      maximumHeapBytes: maximumHeap,
      initialRssBytes: initialMemory.rss,
      finalRssBytes: finalMemory.rss,
      maximumRssBytes: maximumRss,
    };
    console.info(`STABILITY_ACCEPTANCE ${JSON.stringify(result)}`);

    expect(finalMemory.heapUsed - initialMemory.heapUsed).toBeLessThan(256 * 1024 * 1024);
    expect(finalMemory.rss - initialMemory.rss).toBeLessThan(512 * 1024 * 1024);

    await application.close();
    application = undefined;
    application = await launchDesktop(userDataDirectory);
    attachLifecycleDiagnostics(application);
    await installNativeLifecycleDiagnostics(application);
    window = await application.firstWindow();
    attachWindowDiagnostics(window);
    await window.getByText(projectDirectory, { exact: true }).click();
    await expect(window.getByTestId('workspace-page')).toBeVisible();
    await expect(window.getByTestId('conversation-select').locator('option')).toHaveCount(
      conversationCount,
    );
  } finally {
    if (application !== undefined) await application.close();
    await closeServer(fixture.server);
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

function attachLifecycleDiagnostics(application: ElectronApplication): void {
  application.once('close', () => console.info('STABILITY_ELECTRON_APPLICATION_CLOSED'));
  application.process().once('exit', (code, signal) => {
    console.info(`STABILITY_ELECTRON_EXIT ${JSON.stringify({ code, signal })}`);
  });
  application.process().stderr?.on('data', (chunk: Buffer | string) => {
    const message = chunk.toString().trim();
    if (message !== '') console.info(`STABILITY_ELECTRON_STDERR ${message}`);
  });
  application.process().stdout?.on('data', (chunk: Buffer | string) => {
    const message = chunk.toString().trim();
    if (message !== '') console.info(`STABILITY_ELECTRON_STDOUT ${message}`);
  });
}

async function installNativeLifecycleDiagnostics(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ app, BrowserWindow }) => {
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}) => {
      console.info(
        `STABILITY_NATIVE ${JSON.stringify({ at: new Date().toISOString(), event, ...details })}`,
      );
    };
    const stack = () => new Error('lifecycle call site').stack?.split('\n').slice(1, 8).join(' | ');

    const originalQuit = app.quit.bind(app);
    app.quit = () => {
      log('app.quit called', { stack: stack() });
      originalQuit();
    };
    const originalExit = app.exit.bind(app);
    app.exit = (exitCode?: number) => {
      log('app.exit called', { exitCode, stack: stack() });
      originalExit(exitCode);
    };

    const instrumentWindow = (window: InstanceType<typeof BrowserWindow>) => {
      const windowId = window.id;
      const originalClose = window.close.bind(window);
      window.close = () => {
        log('BrowserWindow.close called', { windowId, stack: stack() });
        originalClose();
      };
      const originalDestroy = window.destroy.bind(window);
      window.destroy = () => {
        log('BrowserWindow.destroy called', { windowId, stack: stack() });
        originalDestroy();
      };
      window.on('close', () => log('browser-window close', { windowId }));
      window.on('closed', () => log('browser-window closed', { windowId }));
      window.on('unresponsive', () => log('browser-window unresponsive', { windowId }));
      window.on('responsive', () => log('browser-window responsive', { windowId }));
      window.webContents.on('destroyed', () => log('web-contents destroyed', { windowId }));
      window.webContents.on('render-process-gone', (_event, details) =>
        log('render-process-gone', {
          windowId,
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
    };

    for (const window of BrowserWindow.getAllWindows()) instrumentWindow(window);
    app.on('browser-window-created', (_event, window) => instrumentWindow(window));
    app.on('before-quit', () => log('app before-quit'));
    app.on('will-quit', () => log('app will-quit'));
    app.on('window-all-closed', () => log('app window-all-closed'));
    app.on('quit', (_event, exitCode) => log('app quit', { exitCode }));

    const interval = setInterval(() => {
      log('native heartbeat', {
        windows: BrowserWindow.getAllWindows().map((window) => ({
          id: window.id,
          destroyed: window.isDestroyed(),
          visible: window.isVisible(),
          webContentsDestroyed: window.webContents.isDestroyed(),
        })),
      });
    }, 30_000);
    interval.unref();
    log('diagnostics installed', { windowCount: BrowserWindow.getAllWindows().length });
  });
}

function attachWindowDiagnostics(
  window: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
): void {
  window.once('close', () => console.info('STABILITY_WINDOW_CLOSED'));
  window.once('crash', () => console.info('STABILITY_RENDERER_CRASHED'));
  window.on('pageerror', (error) => console.info(`STABILITY_PAGE_ERROR ${error.message}`));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function memorySample(application: ElectronApplication): Promise<MemorySample> {
  const memory = await application.evaluate(() => process.memoryUsage());
  return { at: new Date().toISOString(), heapUsed: memory.heapUsed, rss: memory.rss };
}

async function forceMainProcessGarbageCollection(application: ElectronApplication): Promise<void> {
  const garbageCollectorWasExposed = await application.evaluate(() => {
    const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    collectGarbage?.();
    return collectGarbage !== undefined;
  });
  expect(garbageCollectorWasExposed).toBe(true);
}

async function hideWindowDuringSoak(application: ElectronApplication): Promise<void> {
  const hidden = await application.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined || window.isDestroyed()) return false;
    // The long soak drives the renderer through Playwright and does not need a
    // user-facing window. Disabling throttling keeps the hidden renderer under
    // the same sustained workload while preventing accidental manual closure.
    window.webContents.setBackgroundThrottling(false);
    window.hide();
    return !window.isVisible();
  });
  expect(hidden).toBe(true);
}

async function startProviderFixture(): Promise<{
  readonly baseUrl: string;
  readonly server: Server;
}> {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: [
            { id: 'stability-model-a', owned_by: 'fixture' },
            { id: 'stability-model-b', owned_by: 'fixture' },
          ],
        }),
      );
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
        readonly messages?: ReadonlyArray<{ readonly role?: string; readonly content?: string }>;
      };
      const prompt = parsed.messages?.findLast((message) => message.role === 'user')?.content ?? '';
      const event = {
        id: 'stability-response',
        choices: [{ delta: { content: `稳定回复：${prompt}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 8 },
      };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
