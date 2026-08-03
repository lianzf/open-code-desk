import type { CommandExecution } from '@open-code-desk/domain';

import type { CommandRepository } from './command.repository';
import type { ApprovalOutcome, CommandLifecycleEvent } from './command-lifecycle';

interface PendingApproval {
  readonly resolve: (outcome: ApprovalOutcome) => void;
  readonly signal: AbortSignal;
  readonly abortListener: () => void;
}

export class CommandApprovalQueue {
  readonly #pending = new Map<string, PendingApproval>();

  public constructor(
    private readonly repository: CommandRepository,
    private readonly emit: (event: CommandLifecycleEvent) => void,
  ) {}

  public has(commandId: string): boolean {
    return this.#pending.has(commandId);
  }

  public ids(): ReadonlyArray<string> {
    return [...this.#pending.keys()];
  }

  public wait(command: CommandExecution, signal: AbortSignal): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      const abortListener = () => {
        if (!this.#pending.has(command.id)) return;
        const cancelled = this.repository.update(command.id, {
          status: 'cancelled',
          error: {
            code: 'CANCELLED',
            message: 'The Agent task was cancelled while waiting for command approval.',
            retryable: true,
          },
          completedAt: new Date().toISOString(),
        });
        this.resolve(command.id, 'cancelled');
        this.emit({ type: 'command_status', command: cancelled });
      };
      this.#pending.set(command.id, { resolve, signal, abortListener });
      signal.addEventListener('abort', abortListener, { once: true });
    });
  }

  public resolve(commandId: string, outcome: ApprovalOutcome): void {
    const pending = this.#pending.get(commandId);
    if (pending === undefined) return;
    this.#pending.delete(commandId);
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.resolve(outcome);
  }
}
