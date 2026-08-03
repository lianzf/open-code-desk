import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { JavaDebugAdapterProvider } from './java-debug-adapter.provider';

const acceptanceEnabled = process.env.OPEN_CODE_DESK_JAVA_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('Java debugger native acceptance', () => {
  let session: DebugAdapterSession | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-java-debug-'));
    await mkdir(join(root, 'src', 'main', 'java', 'demo'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'pom.xml'), pomFixture, 'utf8'),
      writeFile(join(root, 'src', 'main', 'java', 'demo', 'Main.java'), javaFixture, 'utf8'),
    ]);
  });

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it('hits a breakpoint, reads variables, steps, handles an exception, and cleans up', async () => {
    const javaHome = process.env.OPEN_CODE_DESK_JAVA_HOME;
    if (javaHome === undefined) throw new Error('OPEN_CODE_DESK_JAVA_HOME is required.');
    const javaExecutable = join(
      javaHome,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java',
    );
    const provider = new JavaDebugAdapterProvider({
      jdtLsRoot: resolve('apps/desktop/vendor/jdtls-1.60.0'),
      debugPluginPath: resolve(
        'apps/desktop/vendor/java-debug-0.59.0/com.microsoft.java.debug.plugin-0.53.2.jar',
      ),
      executableCandidates: [javaExecutable],
      startupTimeoutMs: 180_000,
    });
    expect(await provider.isAvailable()).toBe(true);
    session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000010',
      workspaceRoot: root,
      command: command(),
      environment: {},
      sensitiveValues: [],
      breakpoints: [breakpoint()],
      exceptionPolicy: {
        exceptionPauseMode: 'all',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: ['IllegalArgumentException'],
      },
    });
    const events = eventQueue(session);
    const stopped = await events.next('stopped', 60_000);
    if (stopped.type !== 'stopped') throw new Error('Expected a Java breakpoint stop.');
    const frames = await session.stackTrace(stopped.threadId);
    const frame = frames.find((item) => item.relativePath?.endsWith('Main.java') === true);
    expect(frame).toMatchObject({ line: 7 });
    const scopes = await session.scopes(frame?.id ?? frames[0]?.id ?? 0);
    const variables = (
      await Promise.all(scopes.map((scope) => session?.variables(scope.variablesReference) ?? []))
    ).flat();
    expect(variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'left', value: '20' }),
        expect.objectContaining({ name: 'right', value: '22' }),
      ]),
    );

    const steppedPromise = events.next('stopped', 30_000);
    await session.next(stopped.threadId);
    const stepped = await steppedPromise;
    if (stepped.type !== 'stopped') throw new Error('Expected a Java step stop.');
    const exceptionPromise = events.next('stopped', 30_000);
    await session.continue(stepped.threadId);
    const exceptionStop = await exceptionPromise;
    if (exceptionStop.type !== 'stopped') throw new Error('Expected a Java exception stop.');
    expect(exceptionStop.reason).toBe('exception');
    const exception = await session.exceptionInfo(exceptionStop.threadId);
    expect(exception?.exceptionId).toContain('IllegalStateException');

    const terminatedPromise = events.next('terminated', 30_000);
    await session.continue(exceptionStop.threadId);
    await expect(terminatedPromise).resolves.toMatchObject({ type: 'terminated' });
    await session.disconnect();
    session = undefined;
  }, 240_000);
});

function command(): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Java acceptance',
    projectType: 'java-maven',
    executable: 'mvn',
    runtimeArgs: [],
    args: ['test'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

function breakpoint(): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000002',
    workspaceId: '00000000-0000-4000-8000-000000000003',
    relativePath: 'src/main/java/demo/Main.java',
    line: 7,
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
        `Timed out waiting for Java debug event ${type}. Events: ${JSON.stringify(buffered)}`,
      );
    },
  };
}

const pomFixture = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo</groupId>
  <artifactId>java-debug-acceptance</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
  </properties>
</project>
`;

const javaFixture = `package demo;

public final class Main {
  public static void main(String[] args) {
    int left = 20;
    int right = 22;
    int answer = left + right;
    System.out.println(answer);
    try {
      throw new IllegalArgumentException("ignored");
    } catch (IllegalArgumentException ignored) {
      System.out.println(ignored.getMessage());
    }
    String marker = "before-exception";
    throw new IllegalStateException(marker);
  }
}
`;
