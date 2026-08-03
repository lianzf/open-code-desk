import { describe, expect, it } from 'vitest';

import type { RunCommandSnapshot } from '@open-code-desk/domain';

import {
  createElectronMainLaunchArguments,
  createElectronRendererAttachArguments,
} from './electron-debug-launch';

describe('Electron js-debug launch arguments', () => {
  it('launches the approved Electron executable and exposes only the approved loopback port', () => {
    const launch = createElectronMainLaunchArguments(command(), 'C:\\workspace', {
      TOKEN: 'secret',
    });
    expect(launch).toMatchObject({
      type: 'pwa-node',
      request: 'launch',
      runtimeExecutable: 'C:\\workspace\\node_modules\\electron\\dist\\electron.exe',
      runtimeArgs: [
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=9333',
        '.',
        '--safe',
      ],
      stopOnEntry: false,
      env: { TOKEN: 'secret' },
    });
  });

  it('attaches the renderer adapter to loopback without launching another browser', () => {
    expect(createElectronRendererAttachArguments(command(), 'C:\\workspace')).toMatchObject({
      type: 'pwa-chrome',
      request: 'attach',
      address: '127.0.0.1',
      port: 9333,
      webRoot: 'C:\\workspace',
      targetSelection: 'automatic',
      restart: true,
    });
  });
});

function command(): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: '2026-08-04T00:00:00.000Z',
    configurationName: 'Electron',
    projectType: 'electron',
    executable: 'C:\\workspace\\node_modules\\electron\\dist\\electron.exe',
    runtimeArgs: [],
    args: ['.', '--safe'],
    workingDirectory: '',
    environmentVariables: [],
    port: 9333,
    console: 'runOutput',
  };
}
