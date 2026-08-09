import type { DebugAdapterEvent } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import type { DapEventMessage } from '../dap/dap-message';
import type { DapOutputCategory } from '../dap/dap-output-redaction';
import { dapOutputCategories } from '../dap/dap-output-redaction';
import { asRecord, booleanValue, numberValue, stringValue } from '../dap/dap-values';
import { dapBreakpointEvent } from './node-debug-session-support';

type ClientRole = 'primary' | 'child' | 'auxiliary';

interface NodeDebugEventContext {
  readonly role: ClientRole | undefined;
  readonly setDebuggeeProcessId: (processId: number | undefined) => void;
  readonly pushOutput: (category: DapOutputCategory, data: string) => void;
  readonly rememberThread: (threadId: number, client: DapClient) => number;
  readonly bootstrapEntry: (client: DapClient, threadId: number, publicThreadId: number) => boolean;
  readonly flushOutput: () => void;
  readonly emit: (event: DebugAdapterEvent) => void;
}

export function handleNodeDebugEvent(
  client: DapClient,
  event: DapEventMessage,
  context: NodeDebugEventContext,
): void {
  const body = asRecord(event.body);
  if (event.event === 'process') {
    if (context.role !== 'auxiliary') {
      context.setDebuggeeProcessId(numberValue(body, 'systemProcessId'));
    }
  } else if (event.event === 'output') {
    const rawCategory = stringValue(body, 'category');
    const category = dapOutputCategories.find((value) => value === rawCategory) ?? 'console';
    context.pushOutput(category, stringValue(body, 'output') ?? '');
  } else if (event.event === 'stopped') {
    const threadId = numberValue(body, 'threadId');
    if (threadId === undefined) return;
    const publicThreadId = context.rememberThread(threadId, client);
    if (
      stringValue(body, 'reason') === 'entry' &&
      context.bootstrapEntry(client, threadId, publicThreadId)
    ) {
      return;
    }
    const description = stringValue(body, 'description');
    context.emit({
      type: 'stopped',
      threadId: publicThreadId,
      reason: stringValue(body, 'reason') ?? 'pause',
      ...(description === undefined ? {} : { description }),
    });
  } else if (event.event === 'continued') {
    const threadId = numberValue(body, 'threadId');
    const publicThreadId =
      threadId === undefined ? undefined : context.rememberThread(threadId, client);
    context.emit({
      type: 'continued',
      ...(publicThreadId === undefined ? {} : { threadId: publicThreadId }),
    });
  } else if (event.event === 'terminated') {
    context.flushOutput();
    if (context.role !== 'auxiliary') {
      context.emit({ type: 'terminated', restart: booleanValue(body, 'restart') ?? false });
    } else {
      context.emit({
        type: 'output',
        category: 'telemetry',
        data: 'Electron renderer debug target disconnected.\n',
      });
    }
  } else if (event.event === 'breakpoint') {
    context.emit(dapBreakpointEvent(asRecord(body.breakpoint)));
  }
}
