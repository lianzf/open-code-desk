import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { forceKillProcessTree } from '../../run/run-process-runtime';
import { PythonDebugAdapterProvider } from './python-debug-adapter.provider';

const temporaryPaths: string[] = [];
const pythonExecutable =
  process.env.OPEN_CODE_DESK_PYTHON_EXECUTABLE ??
  (process.platform === 'win32' ? 'python.exe' : 'python3');

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('PythonDebugAdapterProvider integration', () => {
  it('hits a real breakpoint, exposes local variables, evaluates and steps', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-python-debug-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'main.py'),
      [
        'import os',
        'def calculate(value):',
        '    doubled = value * 2',
        '    result = doubled + 1',
        '    return result',
        "print(os.environ.get('API_TOKEN', 'missing'))",
        'print(calculate(21))',
      ].join('\n'),
      'utf8',
    );
    let session: DebugAdapterSession | undefined;
    const secret = 'python-stage-f-secret';
    try {
      session = await createProvider().createSession({
        sessionId: '00000000-0000-4000-8000-000000000101',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000102', 'main.py'),
        environment: { API_TOKEN: secret },
        sensitiveValues: [secret],
        breakpoints: [breakpoint('00000000-0000-4000-8000-000000000103', 3)],
        exceptionPolicy: {
          exceptionPauseMode: 'uncaught',
          exceptionBreakTypes: [],
          exceptionIgnoreTypes: [],
        },
      });

      expect(session.capabilities).toMatchObject({
        conditionalBreakpoints: true,
        hitConditionalBreakpoints: true,
        logPoints: true,
        exceptionInfo: true,
      });
      let stoppedObserved = false;
      let redactedOutputObserved = false;
      const observed = await collectEventsUntil(
        session,
        'Python breakpoint and redacted output',
        (event) => {
          if (event.type === 'stopped') stoppedObserved = true;
          if (event.type === 'output' && event.data.includes('[REDACTED]')) {
            redactedOutputObserved = true;
          }
          return stoppedObserved && redactedOutputObserved;
        },
      );
      expect(JSON.stringify(observed.events)).not.toContain(secret);
      expect(redactedOutputObserved).toBe(true);
      const stopped = observed.events.find((event) => event.type === 'stopped');
      if (stopped?.type !== 'stopped') throw new Error('Expected a stopped event.');
      const frames = await session.stackTrace(stopped.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'main.py', line: 3 });
      const scopes = await session.scopes(frames[0]?.id ?? 0);
      const variables = (
        await Promise.all(scopes.map((scope) => session?.variables(scope.variablesReference) ?? []))
      ).flat();
      expect(variables).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'value', value: '21' })]),
      );

      const stepped = collectEvent(
        session,
        'Python step over',
        (event) => event.type === 'stopped',
      );
      await session.next(stopped.threadId);
      const stepEvent = await stepped;
      expect(stepEvent).toMatchObject({ type: 'stopped', reason: 'step' });
      if (stepEvent.type !== 'stopped') throw new Error('Expected a step event.');
      const stepFrames = await session.stackTrace(stepEvent.threadId);
      const evaluation = await session.evaluate('doubled', stepFrames[0]?.id, 'watch');
      expect(evaluation.result).toBe('42');

      const terminated = collectEvent(
        session,
        'Python termination',
        (event) => event.type === 'terminated',
      );
      await session.continue(stepEvent.threadId);
      await expect(terminated).resolves.toMatchObject({ type: 'terminated' });
    } finally {
      await session?.disconnect();
    }
  }, 30_000);

  it('captures a real Python exception with source location and details', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-python-exception-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'failure.py'),
      ['def crash():', "    raise ValueError('python-stage-f')", 'crash()'].join('\n'),
      'utf8',
    );
    let session: DebugAdapterSession | undefined;
    try {
      session = await createProvider().createSession({
        sessionId: '00000000-0000-4000-8000-000000000111',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000112', 'failure.py'),
        environment: {},
        sensitiveValues: [],
        breakpoints: [],
        exceptionPolicy: {
          exceptionPauseMode: 'all',
          exceptionBreakTypes: [],
          exceptionIgnoreTypes: [],
        },
      });
      const stopped = await collectEvent(
        session,
        'Python exception',
        (event) => event.type === 'stopped' && event.reason === 'exception',
      );
      if (stopped.type !== 'stopped') throw new Error('Expected an exception event.');
      const exception = await session.exceptionInfo(stopped.threadId);
      expect(exception).toMatchObject({
        exceptionId: expect.stringContaining('ValueError'),
      });
      expect(JSON.stringify(exception)).toContain('python-stage-f');
      const frames = await session.stackTrace(stopped.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'failure.py', line: 2 });
    } finally {
      await session?.disconnect();
    }
  }, 30_000);

  it('automatically continues ignored Python exceptions and exposes the next exception', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-python-ignore-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'named_errors.py'),
      [
        'class IgnoredError(Exception):',
        '    pass',
        'class TargetError(Exception):',
        '    pass',
        'try:',
        "    raise IgnoredError('ignored')",
        'except IgnoredError:',
        '    pass',
        'try:',
        "    raise TargetError('target')",
        'except TargetError:',
        '    pass',
      ].join('\n'),
      'utf8',
    );
    let session: DebugAdapterSession | undefined;
    try {
      session = await createProvider().createSession({
        sessionId: '00000000-0000-4000-8000-000000000121',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000122', 'named_errors.py'),
        environment: {},
        sensitiveValues: [],
        breakpoints: [],
        exceptionPolicy: {
          exceptionPauseMode: 'all',
          exceptionBreakTypes: [],
          exceptionIgnoreTypes: ['IgnoredError'],
        },
      });
      const stopped = await collectEvent(
        session,
        'non-ignored Python exception',
        (event) => event.type === 'stopped' && event.reason === 'exception',
      );
      if (stopped.type !== 'stopped') throw new Error('Expected an exception event.');
      expect(await session.exceptionInfo(stopped.threadId)).toMatchObject({
        exceptionId: expect.stringContaining('TargetError'),
      });
      const terminated = collectEvent(
        session,
        'Python named exception termination',
        (event) => event.type === 'terminated',
      );
      await session.continue(stopped.threadId);
      await terminated;
    } finally {
      await session?.disconnect();
    }
  }, 30_000);

  it('attaches to a real debugpy target with remote source mapping', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-python-attach-local-'));
    const remoteRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-python-attach-remote-'));
    temporaryPaths.push(workspaceRoot, remoteRoot);
    const readyPath = join(remoteRoot, 'ready.txt');
    const port = await reservePort();
    const source = [
      'import debugpy',
      'from pathlib import Path',
      `debugpy.listen(("127.0.0.1", ${port}))`,
      `Path(${JSON.stringify(readyPath)}).write_text("ready", encoding="utf-8")`,
      'debugpy.wait_for_client()',
      'def calculate(value):',
      '    doubled = value * 2',
      '    return doubled + 1',
      'print(calculate(21))',
    ].join('\n');
    await Promise.all([
      writeFile(join(workspaceRoot, 'main.py'), source, 'utf8'),
      writeFile(join(remoteRoot, 'main.py'), source, 'utf8'),
    ]);
    const vendorRoot = join(process.cwd(), 'apps', 'desktop', 'vendor', 'debugpy-1.8.21');
    const target = spawn(pythonExecutable, [join(remoteRoot, 'main.py')], {
      cwd: remoteRoot,
      env: {
        ...process.env,
        PYTHONPATH: [vendorRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let session: DebugAdapterSession | undefined;
    try {
      await waitForTarget(readyPath, target);
      session = await createProvider().createSession({
        sessionId: '00000000-0000-4000-8000-000000000131',
        workspaceRoot,
        command: {
          ...command('00000000-0000-4000-8000-000000000132', 'main.py'),
          debugAttach: {
            adapter: 'debugpy',
            environment: 'remote',
            host: '127.0.0.1',
            port,
            remoteRoot,
          },
        },
        environment: {},
        sensitiveValues: [],
        breakpoints: [breakpoint('00000000-0000-4000-8000-000000000133', 7)],
        exceptionPolicy: {
          exceptionPauseMode: 'uncaught',
          exceptionBreakTypes: [],
          exceptionIgnoreTypes: [],
        },
      });

      const stopped = await collectEvent(
        session,
        'remote Python breakpoint',
        (event) => event.type === 'stopped',
      );
      if (stopped.type !== 'stopped') throw new Error('Expected a stopped event.');
      const frames = await session.stackTrace(stopped.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'main.py', line: 7 });
      const scopes = await session.scopes(frames[0]?.id ?? 0);
      const variables = (
        await Promise.all(scopes.map((scope) => session?.variables(scope.variablesReference) ?? []))
      ).flat();
      expect(variables).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'value', value: '21' })]),
      );
      const terminated = collectEvent(
        session,
        'remote Python termination',
        (event) => event.type === 'terminated',
      );
      await session.continue(stopped.threadId);
      await terminated;
    } finally {
      await session?.disconnect();
      await forceKillProcessTree(target);
    }
  }, 45_000);
});

function createProvider(): PythonDebugAdapterProvider {
  return new PythonDebugAdapterProvider({
    adapterPath: join(
      process.cwd(),
      'apps',
      'desktop',
      'vendor',
      'debugpy-1.8.21',
      'debugpy',
      'adapter',
    ),
  });
}

function command(configurationId: string, program: string) {
  return {
    configurationId,
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Python integration fixture',
    projectType: 'python' as const,
    executable: pythonExecutable,
    runtimeArgs: [],
    args: [program],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput' as const,
  };
}

function breakpoint(id: string, line: number) {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: '00000000-0000-4000-8000-000000000104',
    relativePath: 'main.py',
    line,
    kind: 'line' as const,
    enabled: true,
    status: 'pending' as const,
    createdAt: now,
    updatedAt: now,
  };
}

function collectEvent(
  session: DebugAdapterSession,
  label: string,
  predicate: (event: DebugAdapterEvent) => boolean,
  timeoutMs = 15_000,
): Promise<DebugAdapterEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const seen: DebugAdapterEvent[] = [];
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${label}. Seen: ${JSON.stringify(seen)}`));
    }, timeoutMs);
    const subscribed = session.subscribe((event) => {
      seen.push(event);
      if (predicate(event)) {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
    unsubscribe = subscribed;
    if (settled) unsubscribe();
  });
}

async function collectEventsUntil(
  session: DebugAdapterSession,
  label: string,
  predicate: (event: DebugAdapterEvent) => boolean,
): Promise<{
  readonly event: DebugAdapterEvent;
  readonly events: ReadonlyArray<DebugAdapterEvent>;
}> {
  const events: DebugAdapterEvent[] = [];
  const event = await collectEvent(session, label, (candidate) => {
    events.push(candidate);
    return predicate(candidate);
  });
  return { event, events };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === 'string') throw new Error('Failed to reserve a port.');
  return address.port;
}

async function waitForTarget(path: string, child: ChildProcess): Promise<void> {
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_096);
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await stat(path).catch(() => null))?.isFile() === true) return;
    if (child.exitCode !== null) {
      throw new Error(`debugpy target exited early (${child.exitCode}): ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for debugpy target: ${stderr}`);
}
