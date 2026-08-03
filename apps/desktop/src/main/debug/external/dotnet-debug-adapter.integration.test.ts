import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { DebugAdapterSession } from '../debug-adapter';
import { DotnetDebugAdapterProvider } from './dotnet-debug-adapter.provider';

const temporaryDirectories: string[] = [];
const sessions: DebugAdapterSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.disconnect()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('NetCoreDbg stdio adapter integration', () => {
  it('runs a complete DAP handshake through a real child-process stdio transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-netcoredbg-integration-'));
    temporaryDirectories.push(root);
    const adapterScript = join(root, 'fake-netcoredbg.mjs');
    await writeFile(adapterScript, fakeAdapterScript, 'utf8');
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'bin', 'Demo.dll'), 'compiled fixture', 'utf8');
    await writeFile(join(root, 'Program.cs'), 'Console.WriteLine("demo");\n', 'utf8');
    const provider = new DotnetDebugAdapterProvider({
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

    await expect(session.threads()).resolves.toEqual([{ id: 1, name: 'Main Thread' }]);
    await expect(session.stackTrace(1)).resolves.toEqual([
      expect.objectContaining({ name: 'Program.Main', relativePath: 'Program.cs', line: 1 }),
    ]);
    expect(session.capabilities).toMatchObject({
      functionBreakpoints: true,
      setVariable: true,
      exceptionInfo: true,
    });
    expect(events).toContain('stopped');
  });
});

function fixture(): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'NetCoreDbg integration fixture',
    projectType: 'dotnet',
    executable: 'bin/Demo.dll',
    runtimeArgs: [],
    args: [],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

const fakeAdapterScript = String.raw`
let buffer = Buffer.alloc(0);
let sequence = 1;

function send(message) {
  const body = Buffer.from(JSON.stringify({ seq: sequence++, ...message }), 'utf8');
  process.stdout.write(Buffer.concat([
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
      supportsFunctionBreakpoints: true,
      supportsSetVariable: true,
      supportsExceptionInfoRequest: true,
    });
    send({ type: 'event', event: 'initialized', body: {} });
  } else if (request.command === 'threads') {
    respond(request, { threads: [{ id: 1, name: 'Main Thread' }] });
  } else if (request.command === 'stackTrace') {
    respond(request, {
      stackFrames: [{
        id: 10,
        name: 'Program.Main',
        source: { name: 'Program.cs', path: process.cwd() + '/Program.cs' },
        line: 1,
        column: 1,
      }],
      totalFrames: 1,
    });
  } else {
    respond(request, request.command === 'setFunctionBreakpoints' || request.command === 'setDataBreakpoints'
      ? { breakpoints: [] }
      : {});
    if (request.command === 'configurationDone') {
      send({ type: 'event', event: 'process', body: { systemProcessId: process.pid } });
      send({ type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
    }
    if (request.command === 'disconnect') setTimeout(() => process.exit(0), 10);
  }
}
process.stdin.on('data', (chunk) => {
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
`;
