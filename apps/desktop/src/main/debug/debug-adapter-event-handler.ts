import type { DebugEvent, DebugSession } from '@open-code-desk/domain';

import type { DebugAdapterEvent, DebugAdapterSession } from './debug-adapter';
import type { DebugSessionRepository } from './debug-session.repository';

export interface ActiveDebugSession {
  readonly adapter: DebugAdapterSession;
  unsubscribe(): void;
  terminating: boolean;
}

export interface HandleDebugAdapterEventInput {
  readonly sessionId: string;
  readonly event: DebugAdapterEvent;
  readonly sessions: DebugSessionRepository;
  readonly active: ActiveDebugSession | undefined;
  readonly nextOutputSequence: () => number;
  readonly removeActive: () => void;
  readonly emit: (event: DebugEvent) => void;
  readonly emitStatus: (previous: DebugSession, session: DebugSession) => void;
  readonly updateBreakpoint: (
    workspaceId: string,
    event: Extract<DebugAdapterEvent, { type: 'breakpoint' }>,
  ) => Promise<void>;
}

export async function handleDebugAdapterEvent(
  input: HandleDebugAdapterEventInput,
): Promise<'completed' | 'handled'> {
  const current = input.sessions.findById(input.sessionId);
  if (current === null || ['stopped', 'completed', 'failed', 'rejected'].includes(current.status)) {
    return 'handled';
  }
  if (input.event.type === 'output') {
    input.sessions.update(input.sessionId, {
      outputBytes: current.outputBytes + Buffer.byteLength(input.event.data),
      outputTail: `${current.outputTail}${input.event.data}`.slice(-65_536),
    });
    input.emit({
      type: 'output',
      sessionId: input.sessionId,
      workspaceId: current.workspaceId,
      category: input.event.category,
      sequence: input.nextOutputSequence(),
      data: input.event.data,
      occurredAt: new Date().toISOString(),
    });
    return 'handled';
  }
  if (input.event.type === 'stopped') {
    if (input.active === undefined) return 'handled';
    const [frames, exception] = await Promise.all([
      input.active.adapter.stackTrace(input.event.threadId),
      input.event.reason === 'exception'
        ? input.active.adapter.exceptionInfo(input.event.threadId)
        : undefined,
    ]);
    const top = frames[0];
    const paused = input.sessions.update(input.sessionId, {
      status: 'paused',
      pause: {
        threadId: input.event.threadId,
        reason: input.event.reason,
        ...(input.event.description === undefined ? {} : { description: input.event.description }),
        ...(top?.relativePath === undefined ? {} : { relativePath: top.relativePath }),
        ...(top === undefined ? {} : { line: top.line, column: top.column, frameId: top.id }),
        ...(exception === undefined ? {} : { exception }),
      },
    });
    input.emitStatus(current, paused);
    return 'handled';
  }
  if (input.event.type === 'continued') {
    if (current.status !== 'running') {
      const running = input.sessions.update(input.sessionId, { status: 'running', pause: null });
      input.emitStatus(current, running);
    }
    return 'handled';
  }
  if (input.event.type === 'breakpoint') {
    await input.updateBreakpoint(current.workspaceId, input.event);
    return 'handled';
  }
  if (input.event.restart || input.active?.terminating === true) return 'handled';
  if (input.active !== undefined) {
    input.active.terminating = true;
    input.active.unsubscribe();
    input.removeActive();
    await input.active.adapter.disconnect();
  }
  const completed = input.sessions.update(input.sessionId, {
    status: 'completed',
    adapterProcessId: null,
    pause: null,
    completedAt: new Date().toISOString(),
  });
  input.emitStatus(current, completed);
  return 'completed';
}
