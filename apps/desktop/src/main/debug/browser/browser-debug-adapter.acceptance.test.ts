import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { BrowserDebugAdapterProvider } from './browser-debug-adapter.provider';

const acceptanceEnabled = process.env.OPEN_CODE_DESK_BROWSER_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('browser js-debug native acceptance', () => {
  let session: DebugAdapterSession | undefined;
  let port = 0;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-browser-debug-'));
    port = await availablePort();
    await Promise.all([
      writeFile(
        join(root, 'index.html'),
        '<!doctype html><body><script src="/app.js"></script></body>\n',
        'utf8',
      ),
      writeFile(
        join(root, 'app.js'),
        [
          "window.addEventListener('load', () => {",
          '  const input = 41;',
          '  debugger;',
          '  const result = input + 1;',
          '  document.body.dataset.result = String(result);',
          '});',
          '',
        ].join('\n'),
        'utf8',
      ),
      writeFile(join(root, 'server.cjs'), serverFixture, 'utf8'),
    ]);
  });

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it('hits a real browser breakpoint, reads variables, steps, and cleans up', async () => {
    const provider = new BrowserDebugAdapterProvider({
      adapterExecutable: process.execPath,
      adapterServerPath: resolve('apps/desktop/vendor/js-debug-1.117.0/src/dapDebugServer.js'),
      browserArguments: ['--headless=new', '--disable-gpu', '--no-first-run'],
    });
    expect(await provider.isAvailable()).toBe(true);
    session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: root,
      command: command(port),
      environment: {},
      sensitiveValues: [],
      breakpoints: [breakpoint()],
      exceptionPolicy: {
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
      },
    });
    const events = eventQueue(session);
    const stopped = await events.next('stopped', 30_000);
    if (stopped.type !== 'stopped') throw new Error('Expected a stopped event.');
    const entryFrames = await session.stackTrace(stopped.threadId);
    expect(entryFrames.find((item) => item.relativePath === 'app.js')).toMatchObject({ line: 3 });
    await session.continue(stopped.threadId);
    const breakpointStop = await events.next('stopped', 15_000);
    if (breakpointStop.type !== 'stopped') throw new Error('Expected a breakpoint stop.');
    const frames = await session.stackTrace(breakpointStop.threadId);
    const frame = frames.find((item) => item.relativePath === 'app.js');
    expect(frame).toMatchObject({ line: 4 });
    const scopes = await session.scopes(frame?.id ?? frames[0]?.id ?? 0);
    const variables = (
      await Promise.all(scopes.map((scope) => session?.variables(scope.variablesReference) ?? []))
    ).flat();
    expect(variables).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'input', value: '41' })]),
    );

    await session.next(breakpointStop.threadId);
    const stepped = await events.next('stopped', 15_000);
    expect(stepped.type).toBe('stopped');
    const debuggeeProcessId = session.processId;
    expect(debuggeeProcessId).toBeGreaterThan(0);
    await session.disconnect();
    session = undefined;
    await expectPortClosed(port, 10_000);
    await expectProcessExited(debuggeeProcessId, 10_000);
  }, 60_000);
});

function command(port: number): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Browser acceptance',
    projectType: 'react',
    executable: process.execPath,
    runtimeArgs: [],
    args: [join(root, 'server.cjs'), String(port)],
    workingDirectory: '',
    environmentVariables: [],
    port,
    console: 'runOutput',
  };
}

function breakpoint(): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000002',
    workspaceId: '00000000-0000-4000-8000-000000000003',
    relativePath: 'app.js',
    line: 4,
    enabled: true,
    kind: 'line',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

function eventQueue(session: DebugAdapterSession) {
  const buffered: DebugAdapterEvent[] = [];
  const unsubscribe = session.subscribe((event) => buffered.push(event));
  return {
    async next(type: DebugAdapterEvent['type'], timeoutMs: number): Promise<DebugAdapterEvent> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const existingIndex = buffered.findIndex((event) => event.type === type);
        if (existingIndex >= 0) return buffered.splice(existingIndex, 1)[0] as DebugAdapterEvent;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      unsubscribe();
      throw new Error(
        `Timed out waiting for browser debug event ${type}. Events: ${JSON.stringify(buffered)}`,
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
        reject(new Error('Could not reserve a browser acceptance port.'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function expectPortClosed(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Development server port ${port} remained open after disconnect.`);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolveOpen) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function expectProcessExited(processId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(processId)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Browser process ${processId} remained active after disconnect.`);
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

const serverFixture = `
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { join } = require('node:path');
const root = __dirname;
const port = Number(process.argv[2]);
const server = createServer(async (request, response) => {
  const name = request.url === '/app.js' ? 'app.js' : 'index.html';
  const content = await readFile(join(root, name));
  response.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html' });
  response.end(content);
});
server.listen(port, '127.0.0.1');
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;
