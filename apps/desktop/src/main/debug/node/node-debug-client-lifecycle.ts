import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugExceptionPolicy,
} from '@open-code-desk/domain';

import type { DapClient } from '../dap/dap-client';
import { setDapSpecialBreakpoints } from '../dap/dap-special-breakpoints';
import { asRecord, stringValue } from '../dap/dap-values';
import type { JavaScriptDebugAdapterProcess } from './node-debug-session-support';
import { sendNodeBreakpoints } from './node-debug-session-support';

export interface NodeDebugClientConfiguration {
  readonly workspaceRoot: string;
  readonly breakpointsByPath: ReadonlyMap<string, ReadonlyArray<DebugBreakpoint>>;
  readonly functionBreakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly dataBreakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly capabilities: DebugAdapterCapabilities;
  readonly exceptionPolicy: DebugExceptionPolicy;
  readonly applyExceptionPolicy: (client: DapClient, policy: DebugExceptionPolicy) => Promise<void>;
}

export async function startNodeDebugClient(
  client: DapClient,
  initializeArguments: Readonly<Record<string, unknown>>,
  requestCommand: 'launch' | 'attach',
  launchArguments: Readonly<Record<string, unknown>>,
  configuration: NodeDebugClientConfiguration,
): Promise<void> {
  const initializedEvent = client.waitForEvent('initialized', 60_000);
  void initializedEvent.catch(() => undefined);
  await client.request('initialize', initializeArguments, 60_000);
  await initializedEvent;
  const launchPromise = client.request(requestCommand, launchArguments, 60_000);
  void launchPromise.catch(() => undefined);
  await configureNodeDebugClient(client, configuration);
  await launchPromise;
}

export async function handleNodeReverseRequest(
  process: JavaScriptDebugAdapterProcess,
  command: string,
  argumentsValue: unknown,
  initializeArguments: Readonly<Record<string, unknown>>,
  configuration: NodeDebugClientConfiguration,
  attachClient: (client: DapClient) => void,
  detachClient: (client: DapClient) => void,
  emitTelemetry: (data: string) => void,
): Promise<unknown> {
  emitTelemetry(`dap.reverse/${command}`);
  if (command !== 'startDebugging') {
    throw new Error(`暂不支持调试器反向请求 ${command}。`);
  }
  const request = asRecord(argumentsValue);
  const requestCommand = stringValue(request, 'request');
  if (requestCommand !== 'launch' && requestCommand !== 'attach') {
    throw new Error('调试器请求了无效的子会话类型。');
  }

  const client = await process.connectClient();
  attachClient(client);
  try {
    await startNodeDebugClient(
      client,
      initializeArguments,
      requestCommand,
      asRecord(request.configuration),
      configuration,
    );
    return {};
  } catch (error) {
    detachClient(client);
    client.dispose();
    throw error;
  }
}

async function configureNodeDebugClient(
  client: DapClient,
  configuration: NodeDebugClientConfiguration,
): Promise<void> {
  for (const [relativePath, breakpoints] of configuration.breakpointsByPath) {
    await sendNodeBreakpoints(client, configuration.workspaceRoot, relativePath, breakpoints);
  }
  await setDapSpecialBreakpoints(
    client,
    'function',
    configuration.functionBreakpoints,
    configuration.capabilities.functionBreakpoints,
  );
  await setDapSpecialBreakpoints(
    client,
    'data',
    configuration.dataBreakpoints,
    configuration.capabilities.dataBreakpoints,
  );
  await configuration.applyExceptionPolicy(client, configuration.exceptionPolicy);
  await client.request('configurationDone');
}
