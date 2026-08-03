import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DebugBreakpoint, RunCommandSnapshot } from '@open-code-desk/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { LldbDebugAdapterProvider } from './lldb-debug-adapter.provider';

const execFileAsync = promisify(execFile);
const acceptanceEnabled = process.env.OPEN_CODE_DESK_LLDB_ACCEPTANCE === '1';
const suite = acceptanceEnabled ? describe : describe.skip;
let root = '';

suite('C LLDB native acceptance', () => {
  let session: DebugAdapterSession | undefined;

  beforeAll(async () => {
    if (process.platform !== 'win32') {
      throw new Error('This acceptance fixture currently exercises the Windows LLVM toolchain.');
    }
    const llvmRoot = requiredEnvironment('OPEN_CODE_DESK_LLVM_ROOT');
    const pythonRoot = requiredEnvironment('OPEN_CODE_DESK_LLDB_PYTHON_ROOT');
    const rustupHome = requiredEnvironment('OPEN_CODE_DESK_RUSTUP_HOME');
    const cargoHome = requiredEnvironment('OPEN_CODE_DESK_CARGO_HOME');
    root = await mkdtemp(join(tmpdir(), 'open-code-desk-lldb-debug-'));
    await Promise.all([
      writeFile(join(root, 'main.c'), cFixture, 'utf8'),
      writeFile(join(root, 'main.cpp'), cppFixture, 'utf8'),
      writeFile(join(root, 'main.rs'), rustFixture, 'utf8'),
      writeFile(join(root, 'rust-runtime.c'), rustRuntimeFixture, 'utf8'),
      writeFile(join(root, 'kernel32.def'), kernel32Definition, 'utf8'),
    ]);
    await execFileAsync(
      join(llvmRoot, 'bin', 'llvm-dlltool.exe'),
      ['-m', 'i386:x86-64', '-d', 'kernel32.def', '-l', 'kernel32.lib'],
      buildOptions(llvmRoot, pythonRoot),
    );
    await execFileAsync(
      join(llvmRoot, 'bin', 'clang.exe'),
      [
        '-target',
        'x86_64-pc-windows-msvc',
        '-g',
        '-gcodeview',
        '-O0',
        '-fno-omit-frame-pointer',
        '-c',
        'main.c',
        '-o',
        'main.obj',
      ],
      buildOptions(llvmRoot, pythonRoot),
    );
    await execFileAsync(
      join(llvmRoot, 'bin', 'lld-link.exe'),
      [
        '/entry:mainCRTStartup',
        '/subsystem:console',
        '/nodefaultlib',
        '/debug',
        '/pdb:main.pdb',
        'main.obj',
        'kernel32.lib',
        '/out:main.exe',
      ],
      buildOptions(llvmRoot, pythonRoot),
    );
    await execFileAsync(
      join(llvmRoot, 'bin', 'clang.exe'),
      [
        '-target',
        'x86_64-pc-windows-msvc',
        '-O0',
        '-ffreestanding',
        '-fno-builtin',
        '-fno-stack-protector',
        '-c',
        'rust-runtime.c',
        '-o',
        'rust-runtime.obj',
      ],
      buildOptions(llvmRoot, pythonRoot),
    );
    await execFileAsync(
      join(cargoHome, 'bin', 'rustc.exe'),
      [
        'main.rs',
        '--target',
        'x86_64-pc-windows-msvc',
        '-C',
        'opt-level=0',
        '-C',
        'debuginfo=2',
        '-C',
        'panic=abort',
        '-C',
        `linker=${join(llvmRoot, 'bin', 'lld-link.exe')}`,
        '-C',
        'link-arg=/entry:mainCRTStartup',
        '-C',
        'link-arg=/subsystem:console',
        '-C',
        'link-arg=/nodefaultlib',
        '-C',
        'link-arg=rust-runtime.obj',
        '-L',
        `native=${root}`,
        '-o',
        'main-rust.exe',
      ],
      rustBuildOptions(llvmRoot, pythonRoot, rustupHome, cargoHome),
    );
    await execFileAsync(
      join(llvmRoot, 'bin', 'clang.exe'),
      [
        '-target',
        'x86_64-pc-windows-msvc',
        '-x',
        'c++',
        '-g',
        '-gcodeview',
        '-O0',
        '-fno-exceptions',
        '-fno-rtti',
        '-fno-omit-frame-pointer',
        '-c',
        'main.cpp',
        '-o',
        'main-cpp.obj',
      ],
      buildOptions(llvmRoot, pythonRoot),
    );
    await execFileAsync(
      join(llvmRoot, 'bin', 'lld-link.exe'),
      [
        '/entry:mainCRTStartup',
        '/subsystem:console',
        '/nodefaultlib',
        '/debug',
        '/pdb:main-cpp.pdb',
        'main-cpp.obj',
        'kernel32.lib',
        '/out:main-cpp.exe',
      ],
      buildOptions(llvmRoot, pythonRoot),
    );
  }, 120_000);

  afterAll(async () => {
    await session?.disconnect().catch(() => undefined);
    if (root !== '') await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it.each([
    { projectType: 'c' as const, sourceFile: 'main.c', executable: 'main.exe', line: 8 },
    {
      projectType: 'cpp' as const,
      sourceFile: 'main.cpp',
      executable: 'main-cpp.exe',
      line: 8,
    },
    {
      projectType: 'rust' as const,
      sourceFile: 'main.rs',
      executable: 'main-rust.exe',
      line: 14,
    },
  ])(
    '$projectType hits a source breakpoint, reads stack and locals, steps, exits, and cleans up',
    async ({ projectType, sourceFile, executable, line }) => {
      const llvmRoot = requiredEnvironment('OPEN_CODE_DESK_LLVM_ROOT');
      const pythonRoot = requiredEnvironment('OPEN_CODE_DESK_LLDB_PYTHON_ROOT');
      const lldbDapExecutable = join(llvmRoot, 'bin', 'lldb-dap.exe');
      const environment = llvmEnvironment(llvmRoot, pythonRoot);
      const provider = new LldbDebugAdapterProvider({
        executableCandidates: [lldbDapExecutable],
      });
      const command = runCommand(projectType, executable);

      expect(await provider.isAvailable()).toBe(true);
      await expect(provider.validateConfiguration(command)).resolves.toMatchObject({ valid: true });
      session = await provider.createSession({
        sessionId: '00000000-0000-4000-8000-000000000040',
        workspaceRoot: root,
        command,
        environment,
        sensitiveValues: [],
        breakpoints: [breakpoint(sourceFile, line)],
        exceptionPolicy: {
          exceptionPauseMode: 'none',
          exceptionBreakTypes: [],
          exceptionIgnoreTypes: [],
        },
      });
      const events = eventQueue(session);
      const stopped = await events.next('stopped', 60_000);
      if (stopped.type !== 'stopped') throw new Error('Expected an LLDB breakpoint stop.');
      expect(stopped.reason).toBe('breakpoint');

      const frames = await session.stackTrace(stopped.threadId);
      const frame = frames.find((item) => item.relativePath === sourceFile);
      expect(frame?.name).toContain('sum');
      expect(frame).toMatchObject({ line });
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
      if (stepped.type !== 'stopped') throw new Error('Expected an LLDB step stop.');
      const terminatedPromise = events.next('terminated', 30_000);
      await session.continue(stepped.threadId);
      await expect(terminatedPromise).resolves.toMatchObject({ type: 'terminated' });
      await session.disconnect();
      session = undefined;
    },
    120_000,
  );
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

function buildOptions(llvmRoot: string, pythonRoot: string) {
  return {
    cwd: root,
    env: llvmEnvironment(llvmRoot, pythonRoot),
    timeout: 60_000,
    windowsHide: true,
  } as const;
}

function rustBuildOptions(
  llvmRoot: string,
  pythonRoot: string,
  rustupHome: string,
  cargoHome: string,
) {
  return {
    ...buildOptions(llvmRoot, pythonRoot),
    env: {
      ...llvmEnvironment(llvmRoot, pythonRoot),
      RUSTUP_HOME: rustupHome,
      CARGO_HOME: cargoHome,
    },
  } as const;
}

function llvmEnvironment(llvmRoot: string, pythonRoot: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  const pathName = process.platform === 'win32' ? 'Path' : 'PATH';
  const inheritedPath = environment[pathName] ?? environment.PATH ?? '';
  return {
    ...environment,
    [pathName]: [join(llvmRoot, 'bin'), pythonRoot, join(pythonRoot, 'DLLs'), inheritedPath]
      .filter(Boolean)
      .join(delimiter()),
  };
}

function delimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function runCommand(projectType: 'c' | 'cpp' | 'rust', executable: string): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000041',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: `${projectType.toUpperCase()} LLDB acceptance`,
    projectType,
    executable,
    runtimeArgs: [],
    args: [],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}

function breakpoint(relativePath: string, line: number): DebugBreakpoint {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000042',
    workspaceId: '00000000-0000-4000-8000-000000000043',
    relativePath,
    line,
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
        `Timed out waiting for LLDB debug event ${type}. Events: ${JSON.stringify(buffered)}`,
      );
    },
  };
}

const kernel32Definition = `LIBRARY KERNEL32.dll
EXPORTS
  ExitProcess
`;

const cFixture = `typedef unsigned int uint32_t;
__declspec(dllimport) void __stdcall ExitProcess(uint32_t exitCode);

static int sum(int left, int right)
{
    const char *marker = "lldb-acceptance";
    int total = left + right;
    volatile int observed = total;
    return observed + marker[0] - marker[0];
}

void mainCRTStartup(void)
{
    int result = sum(20, 22);
    ExitProcess(result == 42 ? 0U : 1U);
}
`;

const cppFixture = `using uint32_t = unsigned int;
extern "C" __declspec(dllimport) void __stdcall ExitProcess(uint32_t exitCode);

static int sum(int left, int right)
{
    const char *marker = "lldb-acceptance";
    int total = left + right;
    volatile int observed = total;
    return observed + marker[0] - marker[0];
}

extern "C" void mainCRTStartup()
{
    int result = sum(20, 22);
    ExitProcess(result == 42 ? 0U : 1U);
}
`;

const rustFixture = `#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[link(name = "kernel32")]
extern "system" { fn ExitProcess(exit_code: u32) -> !; }

#[inline(never)]
fn sum(left: i32, right: i32) -> i32
{
    let marker = b"lldb-acceptance";
    let total = left + right;
    let observed = core::hint::black_box(total);
    observed + marker[0] as i32 - marker[0] as i32
}

#[no_mangle]
pub extern "C" fn mainCRTStartup() -> !
{
    let result = sum(20, 22);
    unsafe { ExitProcess(if result == 42 { 0 } else { 1 }) }
}

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> !
{
    loop {}
}
`;

const rustRuntimeFixture = `typedef unsigned long long size_t;

void *memcpy(void *destination, const void *source, size_t count)
{
    unsigned char *output = (unsigned char *)destination;
    const unsigned char *input = (const unsigned char *)source;
    for (size_t index = 0; index < count; ++index) output[index] = input[index];
    return destination;
}

void *memmove(void *destination, const void *source, size_t count)
{
    unsigned char *output = (unsigned char *)destination;
    const unsigned char *input = (const unsigned char *)source;
    if (output < input) {
        for (size_t index = 0; index < count; ++index) output[index] = input[index];
    } else {
        for (size_t index = count; index > 0; --index) output[index - 1] = input[index - 1];
    }
    return destination;
}

void *memset(void *destination, int value, size_t count)
{
    unsigned char *output = (unsigned char *)destination;
    for (size_t index = 0; index < count; ++index) output[index] = (unsigned char)value;
    return destination;
}

int memcmp(const void *left, const void *right, size_t count)
{
    const unsigned char *first = (const unsigned char *)left;
    const unsigned char *second = (const unsigned char *)right;
    for (size_t index = 0; index < count; ++index) {
        if (first[index] != second[index]) return (int)first[index] - (int)second[index];
    }
    return 0;
}

int __CxxFrameHandler3(void) { return 0; }
int _fltused = 0;
`;
