import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RunCommandSnapshot } from '@open-code-desk/domain';

import { createPythonLaunchArguments, parsePythonLaunchTarget } from './python-debug-launch';

describe('Python debug launch mapping', () => {
  it('maps a script configuration without invoking a shell', () => {
    const command = fixture({ runtimeArgs: ['-u'], args: ['src/main.py', '--port', '8000'] });
    expect(
      createPythonLaunchArguments(command, resolve('workspace'), { MODE: 'test' }),
    ).toMatchObject({
      python: [command.executable],
      pythonArgs: ['-u'],
      program: resolve('workspace', 'src', 'main.py'),
      args: ['--port', '8000'],
      console: 'internalConsole',
      env: { MODE: 'test' },
    });
  });

  it('maps module mode and keeps module arguments separate', () => {
    expect(
      parsePythonLaunchTarget(
        fixture({ runtimeArgs: ['-X', 'dev', '-m', 'pytest', '-q'], args: ['tests'] }),
      ),
    ).toEqual({
      pythonArgs: ['-X', 'dev'],
      module: 'pytest',
      args: ['-q', 'tests'],
    });
  });

  it('rejects inline code and missing entry points with actionable messages', () => {
    expect(() =>
      parsePythonLaunchTarget(fixture({ runtimeArgs: ['-c'], args: ['print(1)'] })),
    ).toThrow('暂不支持 -c');
    expect(() => parsePythonLaunchTarget(fixture({ args: [] }))).toThrow('缺少脚本文件');
  });
});

function fixture(
  overrides: Partial<Pick<RunCommandSnapshot, 'runtimeArgs' | 'args'>>,
): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Python fixture',
    projectType: 'python',
    executable: process.platform === 'win32' ? 'python.exe' : 'python3',
    runtimeArgs: overrides.runtimeArgs ?? [],
    args: overrides.args ?? ['main.py'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}
