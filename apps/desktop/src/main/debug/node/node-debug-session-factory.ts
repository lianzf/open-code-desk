import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugExceptionPolicy,
} from '@open-code-desk/domain';

import type { DapClient } from '../dap/dap-client';
import {
  createLaunchArguments,
  initializeArguments,
  mapCapabilities,
  setNodeExceptionBreakpoints,
} from './node-debug-launch';
import type { CreateNodeDebugAdapterSessionInput } from './node-debug-session-support';

export type NodeExceptionPolicyApplier = (
  client: DapClient,
  policy: DebugExceptionPolicy,
) => Promise<void>;

interface NodeDebugSessionSetup {
  setBreakpoints(
    relativePath: string,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  setFunctionBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  setDataBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>>;
  disconnect(): Promise<void>;
}

interface InitializedNodeSessionInput {
  readonly initializeArguments: Readonly<Record<string, unknown>>;
  readonly applyExceptionPolicy: NodeExceptionPolicyApplier;
  readonly capabilities: DebugAdapterCapabilities;
}

export async function createInitializedNodeSession<T extends NodeDebugSessionSetup>(
  input: CreateNodeDebugAdapterSessionInput,
  instantiate: (initialized: InitializedNodeSessionInput) => T,
): Promise<T> {
  const dapInitializeArguments = input.initializeArguments ?? initializeArguments;
  const applyExceptionPolicy = input.applyExceptionPolicy ?? setNodeExceptionBreakpoints;
  const initializedEvent = input.process.client.waitForEvent('initialized', 60_000);
  void initializedEvent.catch(() => undefined);
  let session: T | undefined;
  try {
    const initializeBody = await input.process.client.request<unknown>(
      'initialize',
      dapInitializeArguments,
      60_000,
    );
    session = instantiate({
      initializeArguments: dapInitializeArguments,
      applyExceptionPolicy,
      capabilities: mapCapabilities(initializeBody),
    });
    await initializedEvent;
    const launchPromise = input.process.client.request<unknown>(
      input.requestCommand ?? 'launch',
      input.launchArguments ??
        createLaunchArguments(input.command, input.workspaceRoot, input.environment),
      60_000,
    );
    void launchPromise.catch(() => undefined);
    for (const path of new Set(
      input.breakpoints.filter((item) => item.kind === 'line').map((item) => item.relativePath),
    )) {
      await session.setBreakpoints(
        path,
        input.breakpoints.filter((item) => item.relativePath === path),
      );
    }
    await session.setFunctionBreakpoints(
      input.breakpoints.filter((item) => item.kind === 'function'),
    );
    await session.setDataBreakpoints(input.breakpoints.filter((item) => item.kind === 'data'));
    await applyExceptionPolicy(input.process.client, input.exceptionPolicy);
    await input.process.client.request('configurationDone');
    await launchPromise;
    return session;
  } catch (error) {
    if (session === undefined) await input.process.dispose();
    else await session.disconnect();
    throw error;
  }
}
