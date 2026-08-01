import type { DebugSession } from '@open-code-desk/domain';
import type { RunToCursorRequest } from '@open-code-desk/ipc-contracts';

import type { DebugAdapterSession } from './debug-adapter';
import type { DebugSessionRepository } from './debug-session.repository';

type DebugControlAction = 'pause' | 'continue' | 'next' | 'stepIn' | 'stepOut';

const controlActions: Readonly<
  Record<DebugControlAction, (adapter: DebugAdapterSession, threadId: number) => Promise<void>>
> = {
  pause: (adapter, threadId) => adapter.pause(threadId),
  continue: (adapter, threadId) => adapter.continue(threadId),
  next: (adapter, threadId) => adapter.next(threadId),
  stepIn: (adapter, threadId) => adapter.stepIn(threadId),
  stepOut: (adapter, threadId) => adapter.stepOut(threadId),
};

export interface DebugSessionControllerOptions {
  readonly sessions: DebugSessionRepository;
  readonly activeAdapter: (sessionId: string) => DebugAdapterSession;
  readonly emitStatus: (previous: DebugSession, session: DebugSession) => void;
}

export class DebugSessionController {
  public constructor(private readonly options: DebugSessionControllerOptions) {}

  public async control(
    sessionId: string,
    threadId: number,
    action: DebugControlAction,
  ): Promise<DebugSession> {
    const session = this.requireSession(sessionId);
    await controlActions[action](this.options.activeAdapter(sessionId), threadId);
    return action === 'pause' ? this.requireSession(sessionId) : this.markRunning(session);
  }

  public async runToCursor(input: RunToCursorRequest): Promise<DebugSession> {
    const session = this.requireSession(input.sessionId);
    if (session.status !== 'paused' || session.pause === undefined) {
      throw new Error('运行到光标位置需要调试会话处于暂停状态。');
    }
    await this.options
      .activeAdapter(input.sessionId)
      .runToCursor(session.pause.threadId, input.relativePath, input.line, input.column);
    return this.markRunning(session);
  }

  private markRunning(previous: DebugSession): DebugSession {
    if (previous.status === 'running') return previous;
    const running = this.options.sessions.update(previous.id, { status: 'running', pause: null });
    this.options.emitStatus(previous, running);
    return running;
  }

  private requireSession(sessionId: string): DebugSession {
    const session = this.options.sessions.findById(sessionId);
    if (session === null) throw new Error('找不到调试会话。');
    return session;
  }
}
