import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { describe, expect, it } from 'vitest';

import {
  createJavaLaunchArguments,
  isDirectJavaLaunch,
  parseDirectJavaMainClass,
} from './java-debug-launch';

describe('Java launch mapping', () => {
  it('recognizes Java executables independently of host path syntax', () => {
    expect(isDirectJavaLaunch(fixture('C:\\jdk-21\\bin\\java.exe', ['demo.Main']))).toBe(true);
    expect(isDirectJavaLaunch(fixture('/opt/jdk-21/bin/java', ['demo.Main']))).toBe(true);
  });

  it('maps an explicit Java main class without a shell', () => {
    const command = fixture('C:\\jdk-21\\bin\\java.exe', ['demo.Main', 'sample']);
    expect(isDirectJavaLaunch(command)).toBe(true);
    expect(parseDirectJavaMainClass(command)).toEqual({ mainClass: 'demo.Main' });
    expect(
      createJavaLaunchArguments(
        command,
        'D:\\workspace',
        { MODE: 'test' },
        { mainClass: 'demo.Main' },
        { classPaths: ['D:\\workspace\\target\\classes'], modulePaths: [] },
      ),
    ).toMatchObject({
      type: 'java',
      request: 'launch',
      mainClass: 'demo.Main',
      args: '"sample"',
      vmArgs: '"-Xmx256m"',
      classPaths: ['D:\\workspace\\target\\classes'],
      javaExec: 'C:\\jdk-21\\bin\\java.exe',
      console: 'internalConsole',
      env: { MODE: 'test' },
    });
  });

  it('rejects missing and jar main targets', () => {
    expect(() => parseDirectJavaMainClass(fixture('java', []))).toThrow('main class');
    expect(() => parseDirectJavaMainClass(fixture('java', ['app.jar']))).toThrow('-jar');
  });
});

function fixture(executable: string, args: ReadonlyArray<string>): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Java fixture',
    projectType: 'java-maven',
    executable,
    runtimeArgs: ['-Xmx256m'],
    args,
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}
