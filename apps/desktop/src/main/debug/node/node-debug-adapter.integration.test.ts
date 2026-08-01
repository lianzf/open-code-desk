import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';

import { NodeDebugAdapterProvider } from './node-debug-adapter.provider';

const temporaryPaths: string[] = [];
const debugAdapterExecutable =
  process.env.OPEN_CODE_DESK_DEBUG_ADAPTER_EXECUTABLE ?? process.execPath;

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('NodeDebugAdapterProvider integration', () => {
  it('supports real conditional breakpoints, hit conditions and logpoints', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-advanced-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'loop.js'),
      [
        'for (let i = 0; i < 5; i += 1) {',
        '  const doubled = i * 2;',
        '  const checkpoint = doubled + 1;',
        "  console.log('loop=' + checkpoint);",
        '}',
      ].join('\n'),
      'utf8',
    );
    const provider = createProvider();
    let session: DebugAdapterSession | undefined;
    const now = new Date().toISOString();
    try {
      session = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000021',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000022', 'loop.js'),
        environment: {},
        sensitiveValues: [],
        breakpoints: [
          {
            id: '00000000-0000-4000-8000-000000000023',
            workspaceId: '00000000-0000-4000-8000-000000000024',
            relativePath: 'loop.js',
            line: 2,
            enabled: true,
            logMessage: 'LOGPOINT i={i}',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: '00000000-0000-4000-8000-000000000025',
            workspaceId: '00000000-0000-4000-8000-000000000024',
            relativePath: 'loop.js',
            line: 3,
            enabled: true,
            condition: 'i === 3',
            hitCondition: '>= 2',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          },
        ],
        exceptionPauseMode: 'none',
      });

      expect(session.capabilities).toMatchObject({
        conditionalBreakpoints: true,
        hitConditionalBreakpoints: true,
        logPoints: true,
      });
      const observed = await collectEventsUntil(
        session,
        'conditional breakpoint',
        (event) => event.type === 'stopped',
      );
      expect(observed.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'output', data: expect.stringContaining('LOGPOINT i=') }),
        ]),
      );
      expect(observed.event).toMatchObject({ type: 'stopped', reason: 'breakpoint' });
      if (observed.event.type !== 'stopped') throw new Error('Expected stopped event.');
      const frames = await session.stackTrace(observed.event.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'loop.js', line: 3 });
      const scopes = await session.scopes(frames[0]?.id ?? 0);
      const variables = (
        await Promise.all(
          scopes
            .filter((scope) => !scope.expensive)
            .map((scope) => session?.variables(scope.variablesReference) ?? []),
        )
      ).flat();
      expect(variables).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'i', value: '3' })]),
      );

      const terminated = collectEvent(
        session,
        'advanced breakpoint termination',
        (event) => event.type === 'terminated',
      );
      await session.continue(observed.event.threadId);
      await expect(terminated).resolves.toMatchObject({ type: 'terminated' });
    } finally {
      await session?.disconnect();
    }
  }, 30_000);

  it('applies all and none exception pause modes to real caught and uncaught errors', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-policy-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'caught.js'),
      [
        'try {',
        "  throw new Error('caught failure');",
        '} catch {}',
        "console.log('continued');",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workspaceRoot, 'uncaught.js'),
      "throw new Error('uncaught failure');",
      'utf8',
    );
    const provider = createProvider();
    let allSession: DebugAdapterSession | undefined;
    let noneSession: DebugAdapterSession | undefined;
    try {
      allSession = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000031',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000032', 'caught.js'),
        environment: {},
        sensitiveValues: [],
        breakpoints: [],
        exceptionPauseMode: 'all',
      });
      const stopped = await collectEvent(
        allSession,
        'caught exception',
        (event) => event.type === 'stopped' && event.reason === 'exception',
      );
      if (stopped.type !== 'stopped') throw new Error('Expected caught exception stop.');
      expect((await allSession.exceptionInfo(stopped.threadId))?.message).toContain(
        'caught failure',
      );
      const allTerminated = collectEvent(
        allSession,
        'all-mode termination',
        (event) => event.type === 'terminated',
      );
      await allSession.continue(stopped.threadId);
      await allTerminated;

      noneSession = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000033',
        workspaceRoot,
        command: command('00000000-0000-4000-8000-000000000034', 'uncaught.js'),
        environment: {},
        sensitiveValues: [],
        breakpoints: [],
        exceptionPauseMode: 'none',
      });
      const observed = await collectEventsUntil(
        noneSession,
        'none-mode termination',
        (event) => event.type === 'terminated',
      );
      expect(observed.events.some((event) => event.type === 'stopped')).toBe(false);
    } finally {
      await Promise.allSettled([allSession?.disconnect(), noneSession?.disconnect()]);
    }
  }, 30_000);

  it('hits a real breakpoint and exposes stack, locals, stepping and termination', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'program.js'),
      [
        'function add(left, right) {',
        '  const total = left + right;',
        '  return total;',
        '}',
        'const answer = add(2, 3);',
        "console.log('answer=' + answer);",
      ].join('\n'),
      'utf8',
    );
    const serverPath = join(
      process.cwd(),
      'apps',
      'desktop',
      'vendor',
      'js-debug-1.117.0',
      'src',
      'dapDebugServer.js',
    );
    const provider = new NodeDebugAdapterProvider({
      executable: debugAdapterExecutable,
      serverPath,
    });
    let session: DebugAdapterSession | undefined;
    const breakpoint = {
      id: '00000000-0000-4000-8000-000000000003',
      workspaceId: '00000000-0000-4000-8000-000000000004',
      relativePath: 'program.js',
      line: 3,
      enabled: true,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      session = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000001',
        workspaceRoot,
        command: {
          configurationId: '00000000-0000-4000-8000-000000000002',
          configurationUpdatedAt: new Date().toISOString(),
          configurationName: 'Node integration fixture',
          projectType: 'node',
          executable: process.execPath,
          runtimeArgs: [],
          args: ['program.js'],
          workingDirectory: '',
          environmentVariables: [],
          console: 'runOutput',
        },
        environment: {},
        sensitiveValues: [],
        breakpoints: [breakpoint],
        exceptionPauseMode: 'uncaught',
      });

      const stopped = await collectEvent(
        session,
        'initial breakpoint',
        (event) => event.type === 'stopped',
      );
      expect(stopped).toMatchObject({ type: 'stopped', reason: 'breakpoint' });
      if (stopped.type !== 'stopped') throw new Error('Expected stopped event.');

      const threads = await session.threads();
      expect(threads.some((thread) => thread.id === stopped.threadId)).toBe(true);
      const frames = await session.stackTrace(stopped.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'program.js', line: 3 });
      expect(frames[0]?.name).toMatch(/add$/u);

      const scopes = await session.scopes(frames[0]?.id ?? 0);
      const localScope = scopes.find((scope) => /local/iu.test(scope.name)) ?? scopes[0];
      expect(localScope).toBeDefined();
      const variables = await session.variables(localScope?.variablesReference ?? 0);
      expect(variables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'left', value: '2' }),
          expect.objectContaining({ name: 'right', value: '3' }),
          expect.objectContaining({ name: 'total', value: '5' }),
        ]),
      );

      const nextStoppedPromise = collectEvent(
        session,
        'step stop',
        (event) => event.type === 'stopped',
      );
      await session.next(stopped.threadId);
      const nextStopped = await nextStoppedPromise;
      expect(nextStopped).toMatchObject({ type: 'stopped', reason: 'step' });

      const terminatedPromise = collectEvent(
        session,
        'termination',
        (event) => event.type === 'terminated',
      );
      await session.continue(stopped.threadId);
      await expect(terminatedPromise).resolves.toMatchObject({ type: 'terminated' });
    } finally {
      await session?.disconnect();
    }
  }, 30_000);

  it('captures a real uncaught exception and redacts sensitive runtime values', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-exception-'));
    temporaryPaths.push(workspaceRoot);
    await writeFile(
      join(workspaceRoot, 'failure.js'),
      [
        'function fail() {',
        "  throw new Error('failure ' + process.env.RUNTIME_SECRET);",
        '}',
        'fail();',
      ].join('\n'),
      'utf8',
    );
    const secret = 'debug-runtime-sensitive-value';
    const provider = new NodeDebugAdapterProvider({
      executable: debugAdapterExecutable,
      serverPath: join(
        process.cwd(),
        'apps',
        'desktop',
        'vendor',
        'js-debug-1.117.0',
        'src',
        'dapDebugServer.js',
      ),
    });
    let session: DebugAdapterSession | undefined;
    try {
      session = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000011',
        workspaceRoot,
        command: {
          configurationId: '00000000-0000-4000-8000-000000000012',
          configurationUpdatedAt: new Date().toISOString(),
          configurationName: 'Node exception fixture',
          projectType: 'node',
          executable: process.execPath,
          runtimeArgs: [],
          args: ['failure.js'],
          workingDirectory: '',
          environmentVariables: [],
          console: 'runOutput',
        },
        environment: { RUNTIME_SECRET: secret },
        sensitiveValues: [secret],
        breakpoints: [],
        exceptionPauseMode: 'uncaught',
      });

      const stopped = await collectEvent(
        session,
        'uncaught exception',
        (event) => event.type === 'stopped' && event.reason === 'exception',
      );
      if (stopped.type !== 'stopped') throw new Error('Expected exception stop event.');
      const exception = await session.exceptionInfo(stopped.threadId);
      expect(exception).toMatchObject({
        exceptionId: 'Error: failure [REDACTED]',
        typeName: 'Error',
        message: 'failure [REDACTED]',
      });
      expect(JSON.stringify(exception)).not.toContain(secret);
      const frames = await session.stackTrace(stopped.threadId);
      expect(frames[0]).toMatchObject({ relativePath: 'failure.js', line: 2 });
    } finally {
      await session?.disconnect();
    }
  }, 30_000);
});

function collectEvent(
  session: DebugAdapterSession,
  label: string,
  predicate: (event: DebugAdapterEvent) => boolean,
  timeoutMs = 10_000,
): Promise<DebugAdapterEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const seen: DebugAdapterEvent[] = [];
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `Timed out waiting for debug adapter event: ${label}. Seen: ${JSON.stringify(seen)}`,
        ),
      );
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

function createProvider(): NodeDebugAdapterProvider {
  return new NodeDebugAdapterProvider({
    executable: debugAdapterExecutable,
    serverPath: join(
      process.cwd(),
      'apps',
      'desktop',
      'vendor',
      'js-debug-1.117.0',
      'src',
      'dapDebugServer.js',
    ),
  });
}

function command(configurationId: string, program: string) {
  return {
    configurationId,
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Node advanced integration fixture',
    projectType: 'node' as const,
    executable: process.execPath,
    runtimeArgs: [],
    args: [program],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput' as const,
  };
}
