import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ElectronDebugAdapterProvider } from './electron-debug-adapter.provider';

const acceptanceEnabled = process.env.OPEN_CODE_DESK_ELECTRON_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('Electron js-debug native acceptance', () => {
  let session: DebugAdapterSession | undefined;
  let port = 0;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-electron-debug-'));
    port = await availablePort();
    await Promise.all([
      writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: 'electron-debug-fixture', main: 'main.cjs' }),
        'utf8',
      ),
      writeFile(join(root, 'main.cjs'), mainFixture, 'utf8'),
      writeFile(
        join(root, 'index.html'),
        '<!doctype html><body><script src="renderer.js"></script></body>\n',
        'utf8',
      ),
      writeFile(join(root, 'renderer.js'), rendererFixture, 'utf8'),
    ]);
  });

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it('hits real main and renderer breakpoints and reads variables from both processes', async () => {
    const provider = new ElectronDebugAdapterProvider({
      adapterExecutable: process.execPath,
      adapterServerPath: resolve('apps/desktop/vendor/js-debug-1.117.0/src/dapDebugServer.js'),
      startupTimeoutMs: 30_000,
    });
    expect(await provider.isAvailable()).toBe(true);
    session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000041',
      workspaceRoot: root,
      command: command(port),
      environment: { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      sensitiveValues: [],
      breakpoints: [breakpoint('main.cjs', 9, '45'), breakpoint('renderer.js', 4, '46')],
      exceptionPolicy: {
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
      },
    });
    const events = eventQueue(session);

    const mainStop = await events.nextStoppedAt('main.cjs', 30_000);
    await expectVariable(session, mainStop.threadId, 'mainValue', '42');
    await session.continue(mainStop.threadId);

    const rendererStop = await events.nextStoppedAt('renderer.js', 30_000);
    expect(rendererStop.threadId).toBeGreaterThanOrEqual(2_000_000_000);
    await expectVariable(session, rendererStop.threadId, 'rendererValue', '42');

    const processId = session.processId;
    await session.disconnect();
    session = undefined;
    await expectProcessExited(processId, 15_000);
  }, 90_000);
});

function command(port: number): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000042',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Electron acceptance',
    projectType: 'electron',
    executable: resolve('apps/desktop/node_modules/electron/dist/electron.exe'),
    runtimeArgs: [],
    args: ['.'],
    workingDirectory: '',
    environmentVariables: [],
    port,
    console: 'runOutput',
  };
}

function breakpoint(relativePath: string, line: number, suffix: string): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: `00000000-0000-4000-8000-0000000000${suffix}`,
    workspaceId: '00000000-0000-4000-8000-000000000044',
    relativePath,
    line,
    enabled: true,
    kind: 'line',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

async function expectVariable(
  session: DebugAdapterSession,
  threadId: number,
  name: string,
  value: string,
): Promise<void> {
  const frames = await session.stackTrace(threadId);
  const frame = frames.find((item) => item.relativePath !== undefined) ?? frames[0];
  const scopes = await session.scopes(frame?.id ?? 0);
  const variables = (
    await Promise.all(scopes.map((scope) => session.variables(scope.variablesReference)))
  ).flat();
  expect(variables.find((variable) => variable.name === name)).toMatchObject({ name, value });
}

function eventQueue(session: DebugAdapterSession) {
  const buffered: DebugAdapterEvent[] = [];
  session.subscribe((event) => buffered.push(event));
  return {
    async nextStoppedAt(relativePath: string, timeoutMs: number) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const stoppedIndex = buffered.findIndex((event) => event.type === 'stopped');
        if (stoppedIndex >= 0) {
          const stopped = buffered.splice(stoppedIndex, 1)[0];
          if (stopped?.type !== 'stopped') continue;
          const frames = await session.stackTrace(stopped.threadId);
          if (frames.some((frame) => frame.relativePath === relativePath)) return stopped;
          await session.continue(stopped.threadId);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      throw new Error(
        `Timed out waiting for Electron breakpoint ${relativePath}. Events: ${JSON.stringify(buffered)}`,
      );
    },
  };
}

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an Electron debug port.'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function expectProcessExited(processId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(processId)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Electron process ${processId} remained active after disconnect.`);
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

const mainFixture = `
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await window.loadFile(join(__dirname, 'index.html'));
  const mainValue = 42;
  console.log('main=' + mainValue);
});
app.on('window-all-closed', () => app.quit());
`;

const rendererFixture = `
setTimeout(() => {
  const rendererValue = 42;
  document.body.dataset.result = String(rendererValue);
}, 3000);
`;
