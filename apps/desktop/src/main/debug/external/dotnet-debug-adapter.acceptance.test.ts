import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { DotnetDebugAdapterProvider } from './dotnet-debug-adapter.provider';

const execFileAsync = promisify(execFile);
const acceptanceEnabled = process.env.OPEN_CODE_DESK_DOTNET_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('.NET NetCoreDbg native acceptance', () => {
  let session: DebugAdapterSession | undefined;

  beforeAll(async () => {
    const dotnetRoot = requiredEnvironment('OPEN_CODE_DESK_DOTNET_ROOT');
    const dotnetExecutable = join(
      dotnetRoot,
      process.platform === 'win32' ? 'dotnet.exe' : 'dotnet',
    );
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-dotnet-debug-'));
    await Promise.all([
      writeFile(join(root, 'DotnetAcceptance.csproj'), projectFixture, 'utf8'),
      writeFile(join(root, 'Program.cs'), programFixture, 'utf8'),
    ]);
    await execFileAsync(
      dotnetExecutable,
      ['build', 'DotnetAcceptance.csproj', '--configuration', 'Debug', '--nologo'],
      {
        cwd: root,
        env: dotnetEnvironment(dotnetRoot, root),
        timeout: 120_000,
        windowsHide: true,
      },
    );
  }, 150_000);

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('hits a source breakpoint, reads stack and locals, steps, exits, and cleans up', async () => {
    const dotnetRoot = requiredEnvironment('OPEN_CODE_DESK_DOTNET_ROOT');
    const netcoredbgExecutable = requiredEnvironment('OPEN_CODE_DESK_NETCOREDBG_PATH');
    const environment = dotnetEnvironment(dotnetRoot, root);
    const provider = new DotnetDebugAdapterProvider({
      executableCandidates: [netcoredbgExecutable],
    });
    const command = runCommand();

    expect(await provider.isAvailable()).toBe(true);
    await expect(provider.validateConfiguration(command)).resolves.toMatchObject({ valid: true });
    session = await provider.createSession({
      sessionId: '00000000-0000-4000-8000-000000000030',
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
    if (stopped.type !== 'stopped') throw new Error('Expected a .NET breakpoint stop.');
    expect(stopped.reason).toBe('breakpoint');

    const frames = await session.stackTrace(stopped.threadId);
    const frame = frames.find((item) => item.relativePath === 'Program.cs');
    expect(frame?.name).toContain('Program.Sum');
    expect(frame).toMatchObject({ line: 9 });
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
    const stepped = await steppedPromise;
    if (stepped.type !== 'stopped') throw new Error('Expected a .NET step stop.');
    const terminatedPromise = events.next('terminated', 30_000);
    await session.continue(stepped.threadId);
    await expect(terminatedPromise).resolves.toMatchObject({ type: 'terminated' });
    await session.disconnect();
    session = undefined;
  }, 120_000);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

function dotnetEnvironment(dotnetRoot: string, workspaceRoot: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  const pathName = process.platform === 'win32' ? 'Path' : 'PATH';
  const inheritedPath = environment[pathName] ?? environment.PATH ?? '';
  return {
    ...environment,
    [pathName]: [dotnetRoot, inheritedPath].filter(Boolean).join(delimiter()),
    DOTNET_ROOT: dotnetRoot,
    DOTNET_MULTILEVEL_LOOKUP: '0',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    NUGET_PACKAGES: join(workspaceRoot, '.nuget'),
  };
}

function delimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function runCommand(): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000031',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: '.NET NetCoreDbg acceptance',
    projectType: 'dotnet',
    executable: 'bin/Debug/net10.0/DotnetAcceptance.dll',
    runtimeArgs: [],
    args: [],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

function breakpoint(): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000032',
    workspaceId: '00000000-0000-4000-8000-000000000033',
    relativePath: 'Program.cs',
    line: 9,
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
        `Timed out waiting for .NET debug event ${type}. Events: ${JSON.stringify(buffered)}`,
      );
    },
  };
}

const projectFixture = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <DebugType>portable</DebugType>
    <Deterministic>true</Deterministic>
  </PropertyGroup>
</Project>
`;

const programFixture = `namespace Acceptance;

internal static class Program
{
    private static int Sum(int left, int right)
    {
        var marker = "netcoredbg-acceptance";
        var total = left + right;
        Console.WriteLine($"{marker}:{total}");
        return total;
    }

    private static void Main()
    {
        Console.WriteLine(Sum(20, 22));
    }
}
`;
