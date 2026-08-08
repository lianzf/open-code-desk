import { describe, expect, it, vi } from 'vitest';

import type { DebugAdapterEvent } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import type { DapEventMessage } from '../dap/dap-message';
import { NodeDebugAdapterSession } from './node-debug-adapter-session';
import type { JavaScriptDebugAdapterProcess } from './node-debug-session-support';

describe('NodeDebugAdapterSession', () => {
  it('keeps output emitted after exited and ends only on terminated', async () => {
    let eventListener: ((event: DapEventMessage) => void) | undefined;
    const client = {
      waitForEvent: vi.fn().mockResolvedValue({}),
      request: vi.fn().mockResolvedValue({}),
      onEvent: vi.fn((listener: (event: DapEventMessage) => void) => {
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }),
      onReverseRequest: vi.fn(() => () => undefined),
      dispose: vi.fn(),
    } as unknown as DapClient;
    const adapterProcess = {
      client,
      processId: 1234,
      onLog: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      connectClient: vi.fn().mockResolvedValue(client),
      dispose: vi.fn().mockResolvedValue(undefined),
    } satisfies JavaScriptDebugAdapterProcess;
    const session = await NodeDebugAdapterSession.create({
      process: adapterProcess,
      workspaceRoot: process.cwd(),
      command: {
        configurationId: '00000000-0000-4000-8000-000000000001',
        configurationUpdatedAt: new Date().toISOString(),
        configurationName: 'Node output ordering fixture',
        projectType: 'node',
        executable: process.execPath,
        runtimeArgs: [],
        args: [],
        workingDirectory: '',
        environmentVariables: [],
        console: 'runOutput',
      },
      environment: {},
      sensitiveValues: [],
      breakpoints: [],
      exceptionPolicy: {
        exceptionPauseMode: 'none',
        exceptionBreakTypes: [],
        exceptionIgnoreTypes: [],
      },
    });
    const events: DebugAdapterEvent[] = [];
    session.subscribe((event) => events.push(event));

    eventListener?.({ seq: 1, type: 'event', event: 'exited', body: { exitCode: 0 } });
    eventListener?.({
      seq: 2,
      type: 'event',
      event: 'output',
      body: { category: 'stdout', output: 'FINAL-OUTPUT\n' },
    });
    eventListener?.({ seq: 3, type: 'event', event: 'terminated', body: {} });

    expect(events).toEqual([
      { type: 'output', category: 'stdout', data: 'FINAL-OUTPUT\n' },
      { type: 'terminated', restart: false },
    ]);
    await session.disconnect();
  });
});
