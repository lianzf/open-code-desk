import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';

import type { CommandExecution, PermissionRuleKind } from '@open-code-desk/domain';
import type { ToolExecutionContext } from '@open-code-desk/tool-core';

import { isPathInside, normalizeRelativePath, toPlatformPath } from '../filesystem/path-policy';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { CommandRepository } from './command.repository';
import {
  assessCommandRisk,
  executableRuleValue,
  matchesExecutableRule,
} from './command-risk-policy';
import { StructuredCommandRunner, type CommandRunResult } from './command-runner';
import { CommandApprovalQueue } from './command-approval-queue';
import { CommandEventPublisher } from './command-event-publisher';
import {
  commandDigest,
  toToolOutput,
  type CommandDecision,
  type CommandListener,
  type CommandToolInput,
  type CommandToolOutput,
} from './command-lifecycle';
import type { PermissionRuleRepository } from './permission-rule.repository';

export class CommandService {
  readonly #running = new Map<string, AbortController>();
  readonly #events: CommandEventPublisher;
  readonly #approvals: CommandApprovalQueue;

  public constructor(
    private readonly repository: CommandRepository,
    private readonly rules: PermissionRuleRepository,
    private readonly workspaces: WorkspaceService,
    private readonly runner: StructuredCommandRunner = new StructuredCommandRunner(),
    private readonly audit?: AuditLogService,
  ) {
    this.#events = new CommandEventPublisher(audit);
    this.#approvals = new CommandApprovalQueue(repository, (event) => this.emit(event));
  }

  public subscribe(taskId: string, listener: CommandListener): () => void {
    return this.#events.subscribe(taskId, listener);
  }

  public listForConversation(conversationId: string): ReadonlyArray<CommandExecution> {
    return this.repository.listForConversation(conversationId);
  }

  public listRules(workspaceId: string) {
    return this.rules.list(workspaceId);
  }

  public addRule(workspaceId: string, kind: PermissionRuleKind, value: string) {
    const rule = this.rules.upsert(workspaceId, kind, value);
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'permission',
      action: 'permission_rule.upsert',
      outcome: 'succeeded',
      summary: `Permission rule ${kind} was saved.`,
      metadata: { kind, ruleId: rule.id },
    });
    return rule;
  }

  public async upsertExecutableRule(
    workspaceId: string,
    kind: Extract<PermissionRuleKind, 'allow_executable' | 'deny_executable'>,
    executable: string,
    requestedCwd: string,
    args: ReadonlyArray<string>,
  ) {
    const workspace = await this.workspaces.getById(workspaceId);
    const cwd = await this.resolveWorkingDirectory(workspace.rootPath, requestedCwd);
    return this.addRule(
      workspaceId,
      kind,
      executableRuleValue(executable, cwd, kind === 'allow_executable' ? args : undefined),
    );
  }

  public setNetworkAccess(workspaceId: string, allowed: boolean) {
    for (const rule of this.rules
      .list(workspaceId)
      .filter((item) => item.kind === 'allow_network_commands')) {
      this.rules.delete(workspaceId, rule.id);
    }
    if (allowed) {
      this.rules.upsert(workspaceId, 'allow_network_commands', 'true');
    }
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'permission',
      action: 'network_commands.configure',
      outcome: 'succeeded',
      summary: allowed
        ? 'Automatic execution of allow-listed network commands was enabled.'
        : 'Automatic execution of network commands was disabled.',
      metadata: { allowed },
    });
    return this.rules.list(workspaceId);
  }

  public deleteRule(workspaceId: string, ruleId: string): boolean {
    const rule = this.rules.list(workspaceId).find((item) => item.id === ruleId);
    const deleted = this.rules.delete(workspaceId, ruleId);
    if (deleted) {
      this.audit?.record({
        workspaceId,
        actor: 'user',
        category: 'permission',
        action: 'permission_rule.delete',
        outcome: 'succeeded',
        summary: `Permission rule ${rule?.kind ?? 'unknown'} was deleted.`,
        metadata: { ruleId, ...(rule === undefined ? {} : { kind: rule.kind }) },
      });
    }
    return deleted;
  }

  public async requestAndExecute(
    toolName: 'run_command' | 'run_tests',
    input: CommandToolInput,
    context: ToolExecutionContext,
  ): Promise<CommandToolOutput> {
    const workspace = await this.workspaces.getById(context.workspaceId);
    const cwd = await this.resolveWorkingDirectory(workspace.rootPath, input.cwd ?? '');
    const id = randomUUID();
    const modelToolCallId = context.modelCallId ?? context.callId;
    const risk = assessCommandRisk({
      executable: input.executable,
      args: input.args,
      cwd,
      workspaceRoot: workspace.rootPath,
    });
    const approvalDigest = commandDigest({
      id,
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      taskId: context.taskId,
      modelToolCallId,
      executable: input.executable,
      args: input.args,
      cwd,
      timeoutMs: input.timeoutMs,
    });
    const rules = this.rules.list(context.workspaceId);
    const denied = rules.some(
      (rule) =>
        rule.kind === 'deny_executable' &&
        matchesExecutableRule(rule, input.executable, cwd, input.args),
    );
    const networkAllowed = rules.some((rule) => rule.kind === 'allow_network_commands');
    const allowListed = rules.some(
      (rule) =>
        rule.kind === 'allow_executable' &&
        matchesExecutableRule(rule, input.executable, cwd, input.args),
    );
    const autoApproved =
      !denied &&
      risk.level !== 'blocked' &&
      risk.level !== 'high' &&
      (!risk.networkAccess || networkAllowed) &&
      allowListed;
    let command = this.repository.create({
      id,
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      taskId: context.taskId,
      modelToolCallId,
      toolName,
      executable: input.executable,
      args: input.args,
      cwd,
      timeoutMs: input.timeoutMs,
      riskLevel: risk.level,
      riskReasons: [
        ...risk.reasons,
        ...(risk.networkAccess && !networkAllowed
          ? ['Network commands are not globally allowed for this workspace.']
          : []),
      ],
      approvalDigest,
    });

    if (risk.level === 'blocked' || denied) {
      command = this.repository.update(command.id, {
        status: 'rejected',
        error: {
          code: 'COMMAND_REJECTED',
          message:
            risk.level === 'blocked'
              ? `The command was blocked by policy: ${risk.reasons.join(' ')}`
              : 'The executable is on the workspace command deny list.',
          retryable: false,
        },
        completedAt: new Date().toISOString(),
      });
      this.emit({ type: 'command_status', command });
      return toToolOutput(command);
    }

    if (autoApproved) {
      command = this.repository.update(command.id, {
        status: 'approved',
        autoApproved: true,
        approvedAt: new Date().toISOString(),
      });
      this.emit({ type: 'command_status', command });
    } else {
      const approval = this.#approvals.wait(command, context.signal);
      this.emit({ type: 'command_proposed', command });
      const outcome = await approval;
      command = this.requireCommand(command.id);
      if (outcome !== 'approved') {
        return toToolOutput(command);
      }
    }

    return this.executeApproved(command, context.signal);
  }

  public decide(input: CommandDecision): CommandExecution {
    const command = this.requireCommand(input.commandId);
    if (command.status !== 'pending_approval') {
      throw new Error('This command is no longer waiting for approval.');
    }
    if (command.approvalDigest !== input.expectedApprovalDigest) {
      throw new Error('The command approval digest is stale.');
    }
    if (!this.#approvals.has(command.id)) {
      throw new Error('The Agent task that requested this command is no longer active.');
    }
    const now = new Date().toISOString();
    const approved = input.decision === 'approve';
    if (
      input.rememberExecutable &&
      approved &&
      command.riskLevel !== 'high' &&
      command.riskLevel !== 'blocked'
    ) {
      this.rules.upsert(
        command.workspaceId,
        'allow_executable',
        executableRuleValue(command.executable, command.cwd, command.args),
      );
    } else if (input.rememberExecutable && !approved) {
      this.rules.upsert(
        command.workspaceId,
        'deny_executable',
        executableRuleValue(command.executable, command.cwd),
      );
    }
    const updated = this.repository.update(command.id, {
      status: approved ? 'approved' : 'rejected',
      ...(approved
        ? { approvedAt: now }
        : {
            completedAt: now,
            error: {
              code: 'COMMAND_REJECTED',
              message: 'The user rejected the command proposal.',
              retryable: true,
            },
          }),
    });
    this.#approvals.resolve(command.id, approved ? 'approved' : 'rejected');
    this.emit({ type: 'command_status', command: updated });
    return updated;
  }

  public cancel(commandId: string): boolean {
    const running = this.#running.get(commandId);
    if (running !== undefined) {
      running.abort(new DOMException('Command cancelled by user.', 'AbortError'));
      return true;
    }
    if (!this.#approvals.has(commandId)) {
      return false;
    }
    const command = this.repository.update(commandId, {
      status: 'cancelled',
      error: {
        code: 'CANCELLED',
        message: 'The command approval was cancelled.',
        retryable: true,
      },
      completedAt: new Date().toISOString(),
    });
    this.#approvals.resolve(commandId, 'cancelled');
    this.emit({ type: 'command_status', command });
    return true;
  }

  public close(): void {
    for (const commandId of this.#approvals.ids()) {
      this.cancel(commandId);
    }
    for (const controller of this.#running.values()) {
      controller.abort(new DOMException('Application is closing.', 'AbortError'));
    }
  }

  private async executeApproved(
    command: CommandExecution,
    taskSignal: AbortSignal,
  ): Promise<CommandToolOutput> {
    const controller = new AbortController();
    const taskAbort = () =>
      controller.abort(taskSignal.reason ?? new DOMException('Task cancelled.', 'AbortError'));
    taskSignal.addEventListener('abort', taskAbort, { once: true });
    this.#running.set(command.id, controller);
    const startedAt = new Date().toISOString();
    command = this.repository.update(command.id, {
      status: 'running',
      startedAt,
      error: null,
    });
    this.emit({ type: 'command_status', command });

    let result: CommandRunResult;
    try {
      result = await this.runner.run(
        {
          executable: command.executable,
          args: command.args,
          cwd: command.cwd,
          timeoutMs: command.timeoutMs,
        },
        controller.signal,
        (output) => {
          this.emit({
            type: 'command_output',
            commandId: command.id,
            taskId: command.taskId,
            stream: output.stream,
            chunk: output.chunk,
          });
        },
      );
    } finally {
      this.#running.delete(command.id);
      taskSignal.removeEventListener('abort', taskAbort);
    }

    const error =
      result.errorMessage === undefined
        ? null
        : {
            code:
              result.status === 'cancelled' ? ('CANCELLED' as const) : ('COMMAND_FAILED' as const),
            message: result.errorMessage,
            retryable: result.status !== 'failed' || result.exitCode !== undefined,
          };
    command = this.repository.update(command.id, {
      status: result.status,
      outputTail: result.outputTail,
      outputBytes: result.outputBytes,
      exitCode: result.exitCode ?? null,
      terminationSignal: result.terminationSignal ?? null,
      error,
      completedAt: new Date().toISOString(),
    });
    this.emit({ type: 'command_status', command });
    return toToolOutput(command);
  }

  private emit(event: Parameters<CommandEventPublisher['emit']>[0]): void {
    this.#events.emit(event);
  }

  private requireCommand(commandId: string): CommandExecution {
    const command = this.repository.findById(commandId);
    if (command === null) {
      throw new Error('Command execution was not found.');
    }
    return command;
  }

  private async resolveWorkingDirectory(rootPath: string, requestedCwd: string): Promise<string> {
    const relativePath = normalizeRelativePath(requestedCwd);
    const candidate = toPlatformPath(rootPath, relativePath);
    const canonical = await realpath(candidate);
    if (!isPathInside(rootPath, canonical) || !(await stat(canonical)).isDirectory()) {
      throw new Error('The command working directory is outside the workspace or not a directory.');
    }
    return canonical;
  }
}
