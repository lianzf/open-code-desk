import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { describe, expect, it } from 'vitest';

import { browserInitializeArguments, createBrowserLaunchArguments } from './browser-debug-launch';

describe('browser js-debug launch mapping', () => {
  it('maps an approved front-end server and port to an isolated browser launch', () => {
    const result = createBrowserLaunchArguments(
      fixture(),
      'D:\\work\\example',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'pwa-chrome',
      ['--headless=new'],
    );

    expect(result).toMatchObject({
      type: 'pwa-chrome',
      request: 'launch',
      url: 'http://127.0.0.1:5173',
      webRoot: 'D:\\work\\example',
      runtimeExecutable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      runtimeArgs: ['--headless=new'],
      cleanUp: 'wholeBrowser',
    });
    expect(browserInitializeArguments('pwa-chrome').adapterID).toBe('pwa-chrome');
  });

  it('rejects a browser configuration without a development-server port', () => {
    expect(() =>
      createBrowserLaunchArguments(fixture(false), 'D:\\work\\example', 'chrome.exe', 'pwa-chrome'),
    ).toThrow('requires a development server port');
  });
});

function fixture(withPort = true): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Browser fixture',
    projectType: 'react',
    executable: 'pnpm',
    runtimeArgs: [],
    args: ['dev'],
    workingDirectory: '',
    environmentVariables: [],
    ...(withPort ? { port: 5173 } : {}),
    console: 'runOutput',
  };
}
