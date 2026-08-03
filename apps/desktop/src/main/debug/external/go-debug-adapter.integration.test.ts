import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { DebugAdapterSession } from '../debug-adapter';
import { GoDebugAdapterProvider } from './go-debug-adapter.provider';

const temporaryDirectories: string[] = [];
const sessions: DebugAdapterSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.disconnect()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Delve TCP adapter integration', () => {
  it('runs a complete DAP handshake through a real child-process TCP transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-delve-integration-'));
    temporaryDirectories.push(root);
    const adapterScript = join(root, 'fake-dlv.mjs');
    await writeFile(adapterScript, fakeAdapterScript, 'utf8');
    await writeFile(join(root, 'go.mod'), 'module example.invalid/demo\n', 'utf8');
    await writeFile(join(root, 'main.go'), 'package main\nfunc main() {}\n', 'utf8');
    const provider = new GoDebugAdapterProvider({
      executableCandidates: [process.execPath],
      adapterArguments: [adapterScript],
    });
    const command = fixture();

    await expect(provider.validateConfiguration(command)).resolves.toMatchObject({ valid: true });
    const session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000002',
      workspaceRoot: root,
      command,
      environment: { MODE: 'test' },
      sensitiveValues: ['must-not-leak'],
      breakpoints: [],
      exceptionPolicy: {
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
      },
    });
    sessions.push(session);
    const events: string[] = [];
    session.subscribe((event) => events.push(event.type));

    await expect(session.threads()).resolves.toEqual([{ id: 1, name: 'goroutine 1' }]);
    await expect(session.stackTrace(1)).resolves.toEqual([
      expect.objectContaining({ name: 'main.main', relativePath: 'main.go', line: 2 }),
    ]);
    expect(session.capabilities).toMatchObject({
      restart: true,
      functionBreakpoints: true,
      exceptionInfo: true,
    });
    expect(events).toContain('stopped');
  });
});

function fixture(): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Delve integration fixture',
    projectType: 'go',
    executable: 'go',
    runtimeArgs: [],
    args: ['run', '.'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

const fakeAdapterScript = String.raw`
import net from 'node:net';

let sequence = 1;
const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  function send(message) {
    const body = Buffer.from(JSON.stringify({ seq: sequence++, ...message }), 'utf8');
    socket.write(Buffer.concat([
      Buffer.from('Content-Length: ' + body.byteLength + '\r\n\r\n', 'ascii'),
      body,
    ]));
  }
  function respond(request, body = {}) {
    send({ type: 'response', request_seq: request.seq, command: request.command, success: true, body });
  }
  function handle(request) {
    if (request.type !== 'request') return;
    if (request.command === 'initialize') {
      respond(request, {
        supportsConfigurationDoneRequest: true,
        supportsConditionalBreakpoints: true,
        supportsHitConditionalBreakpoints: true,
        supportsLogPoints: true,
        supportsFunctionBreakpoints: true,
        supportsExceptionInfoRequest: true,
        supportsRestartRequest: true,
      });
    } else if (request.command === 'launch') {
      send({ type: 'event', event: 'initialized', body: {} });
      respond(request);
    } else if (request.command === 'threads') {
      respond(request, { threads: [{ id: 1, name: 'goroutine 1' }] });
    } else if (request.command === 'stackTrace') {
      respond(request, {
        stackFrames: [{
          id: 10,
          name: 'main.main',
          source: { name: 'main.go', path: process.cwd() + '/main.go' },
          line: 2,
          column: 1,
        }],
        totalFrames: 1,
      });
    } else if (request.command === 'setBreakpoints') {
      const requested = request.arguments?.breakpoints ?? [];
      respond(request, { breakpoints: requested.map((item, index) => ({
        id: index + 1,
        verified: true,
        line: item.line,
      })) });
    } else {
      respond(request, request.command === 'setFunctionBreakpoints' || request.command === 'setDataBreakpoints'
        ? { breakpoints: [] }
        : {});
      if (request.command === 'configurationDone') {
        send({ type: 'event', event: 'process', body: { systemProcessId: process.pid } });
        send({ type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
      }
      if (request.command === 'disconnect') {
        setTimeout(() => server.close(() => process.exit(0)), 10);
      }
    }
  }
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const boundary = buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const header = buffer.subarray(0, boundary).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) process.exit(2);
      const length = Number(match[1]);
      const bodyStart = boundary + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      buffer = buffer.subarray(bodyStart + length);
      handle(JSON.parse(body));
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log('DAP server listening at: 127.0.0.1:' + address.port);
});
`;
