import { describe, expect, it } from 'vitest';

import { createAttachArguments } from './node-debug-launch';

describe('Node.js attach arguments', () => {
  it('maps a reviewed remote target without forwarding local environment values', () => {
    const argumentsValue = createAttachArguments(
      {
        configurationId: '00000000-0000-4000-8000-000000000001',
        configurationUpdatedAt: '2026-08-04T00:00:00.000Z',
        configurationName: 'Container Node',
        projectType: 'node',
        executable: 'node',
        runtimeArgs: [],
        args: [],
        workingDirectory: '',
        environmentVariables: [],
        debugAttach: {
          adapter: 'pwa-node',
          environment: 'container',
          host: '127.0.0.1',
          port: 9229,
          remoteRoot: '/workspace/app',
        },
        console: 'runOutput',
      },
      'D:\\work\\app',
    );
    expect(argumentsValue).toMatchObject({
      request: 'attach',
      address: '127.0.0.1',
      port: 9229,
      localRoot: 'D:\\work\\app',
      remoteRoot: '/workspace/app',
      restart: false,
      continueOnAttach: true,
    });
    expect(argumentsValue).not.toHaveProperty('env');
  });
});
