import type { AuditLogService } from '../audit/audit-log.service';
import type { CommandLifecycleEvent, CommandListener } from './command-lifecycle';

export class CommandEventPublisher {
  readonly #listeners = new Map<string, Set<CommandListener>>();

  public constructor(private readonly audit?: AuditLogService) {}

  public subscribe(taskId: string, listener: CommandListener): () => void {
    const listeners = this.#listeners.get(taskId) ?? new Set<CommandListener>();
    listeners.add(listener);
    this.#listeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(taskId);
    };
  }

  public emit(event: CommandLifecycleEvent): void {
    const taskId = event.type === 'command_output' ? event.taskId : event.command.taskId;
    if (event.type !== 'command_output') {
      const command = event.command;
      const outcome =
        command.status === 'pending_approval'
          ? 'requested'
          : command.status === 'approved'
            ? 'allowed'
            : command.status === 'running'
              ? 'started'
              : command.status === 'completed'
                ? 'succeeded'
                : command.status === 'cancelled'
                  ? 'cancelled'
                  : command.status === 'failed' || command.status === 'timed_out'
                    ? 'failed'
                    : 'denied';
      this.audit?.record({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        taskId: command.taskId,
        actor:
          command.status === 'pending_approval'
            ? 'agent'
            : command.status === 'approved' && !command.autoApproved
              ? 'user'
              : 'system',
        category: 'command',
        action: 'command.execute',
        outcome,
        summary: `Command ${command.executable} changed to ${command.status}.`,
        metadata: {
          commandId: command.id,
          executable: command.executable,
          riskLevel: command.riskLevel,
          status: command.status,
          autoApproved: command.autoApproved,
        },
      });
    }
    for (const listener of this.#listeners.get(taskId) ?? []) listener(event);
  }
}
