import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { GoDebugAdapterProvider } from './go-debug-adapter.provider';

const acceptanceEnabled = process.env.OPEN_CODE_DESK_GO_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('Go Delve native acceptance', () => {
  let session: DebugAdapterSession | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-go-debug-'));
    await Promise.all([
      writeFile(join(root, 'go.mod'), 'module example.invalid/acceptance\n\ngo 1.26\n', 'utf8'),
      writeFile(join(root, 'main.go'), goFixture, 'utf8'),
      mkdir(join(root, '.gocache'), { recursive: true }),
      mkdir(join(root, '.gomodcache'), { recursive: true }),
    ]);
  });

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('hits a source breakpoint, reads stack and locals, steps, exits, and cleans up', async () => {
    const goHome = process.env.OPEN_CODE_DESK_GO_HOME;
    const delveExecutable = process.env.OPEN_CODE_DESK_DLV_PATH;
    if (goHome === undefined) throw new Error('OPEN_CODE_DESK_GO_HOME is required.');
    if (delveExecutable === undefined) throw new Error('OPEN_CODE_DESK_DLV_PATH is required.');
    const goExecutable = join(goHome, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
    const pathName = process.platform === 'win32' ? 'Path' : 'PATH';
    const inheritedPath = process.env[pathName] ?? process.env.PATH ?? '';
    const environment = {
      [pathName]: [dirname(goExecutable), inheritedPath].filter(Boolean).join(delimiter()),
      GOROOT: goHome,
      GOCACHE: join(root, '.gocache'),
      GOMODCACHE: join(root, '.gomodcache'),
    };
    const provider = new GoDebugAdapterProvider({
      executableCandidates: [delveExecutable],
    });
    const command = runCommand(goExecutable);

    expect(await provider.isAvailable()).toBe(true);
    await expect(provider.validateConfiguration(command)).resolves.toMatchObject({ valid: true });
    session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000020',
      workspaceRoot: root,
      command,
      environment,
      sensitiveValues: [],
      breakpoints: [breakpoint()],
      exceptionPolicy: {
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
      },
    });
    const events = eventQueue(session);
    const stopped = await events.next('stopped', 60_000);
    if (stopped.type !== 'stopped') throw new Error('Expected a Go breakpoint stop.');
    expect(stopped.reason).toBe('breakpoint');

    const frames = await session.stackTrace(stopped.threadId);
    const frame = frames.find((item) => item.relativePath === 'main.go');
    expect(frame).toMatchObject({ name: 'main.sum', line: 8 });
    const scopes = await session.scopes(frame?.id ?? frames[0]?.id ?? 0);
    const variables = (
      await Promise.all(scopes.map((scope) => session?.variables(scope.variablesReference) ?? []))
    ).flat();
    expect(variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'left', value: '20' }),
        expect.objectContaining({ name: 'right', value: '22' }),
        expect.objectContaining({ name: 'total', value: '42' }),
      ]),
    );

    const steppedPromise = events.next('stopped', 30_000);
    await session.next(stopped.threadId);
    await expect(steppedPromise).resolves.toMatchObject({ type: 'stopped' });
    const terminatedPromise = events.next('terminated', 30_000);
    await session.continue(stopped.threadId);
    await expect(terminatedPromise).resolves.toMatchObject({ type: 'terminated' });
    await session.disconnect();
    session = undefined;
  }, 120_000);
});

function delimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function runCommand(goExecutable: string): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000021',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Go Delve acceptance',
    projectType: 'go',
    executable: goExecutable,
    runtimeArgs: [],
    args: ['run', '.'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

function breakpoint(): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000022',
    workspaceId: '00000000-0000-4000-8000-000000000023',
    relativePath: 'main.go',
    line: 8,
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
        `Timed out waiting for Go debug event ${type}. Events: ${JSON.stringify(buffered)}`,
      );
    },
  };
}

const goFixture = `package main

import "fmt"

func sum(left int, right int) int {
	marker := "go-delve-acceptance"
	total := left + right
	fmt.Println(marker, total)
	return total
}

func main() {
	result := sum(20, 22)
	fmt.Println(result)
}
`;
