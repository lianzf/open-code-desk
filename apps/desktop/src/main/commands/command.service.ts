import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';

import type { AppError, CommandExecution, PermissionRuleKind } from '@open-code-desk/domain';
import type { ToolExecutionContext } from '@open-code-desk/tool-core';

import { isPathInside, normalizeRelativePath, toPlatformPath } from '../filesystem/path-policy';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { CommandRepository } from './command.repository';
import {
  assessCommandRisk,
  executableRuleValue,
  matchesExecutableRule,
} from './command-risk-policy';
import {
  StructuredCommandRunner,
  type CommandOutputChunk,
  type CommandRunResult,
} from './command-runner';
import type { PermissionRuleRepository } from './permission-rule.repository';

export interface CommandToolInput {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
}

export interface CommandToolOutput {
  readonly commandId: string;
  readonly status: CommandExecution['status'];
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly output: string;
  readonly error?: AppError;
}

export type CommandLifecycleEvent =
  | {
      readonly type: 'command_proposed' | 'command_status';
      readonly command: CommandExecution;
    }
  | {
      readonly type: 'command_output';
      readonly commandId: string;
      readonly taskId: string;
      readonly stream: CommandOutputChunk['stream'];
      readonly chunk: string;
    };

export interface CommandDecision {
  readonly commandId: string;
  readonly expectedApprovalDigest: string;
  readonly decision: 'approve' | 'reject';
  readonly rememberExecutable: boolean;
}

type ApprovalOutcome = 'approved' | 'rejected' | 'cancelled';
type CommandListener = (event: CommandLifecycleEvent) => void;

interface PendingApproval {
  readonly resolve: (outcome: ApprovalOutcome) => void;
  readonly signal: AbortSignal;
  readonly abortListener: () => void;
}

function commandDigest(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly modelToolCallId: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs: number;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function toToolOutput(command: CommandExecution): CommandToolOutput {
  return {
    commandId: command.id,
    status: command.status,
    ...(command.exitCode === undefined ? {} : { exitCode: command.exitCode }),
    ...(command.terminationSignal === undefined
      ? {}
      : { terminationSignal: command.terminationSignal }),
    output: command.outputTail,
    ...(command.error === undefined ? {} : { error: command.error }),
  };
}

export class CommandService {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #running = new Map<string, AbortController>();
  readonly #listeners = new Map<string, Set<CommandListener>>();

  public constructor(
    private readonly repository: CommandRepository,
    private readonly rules: PermissionRuleRepository,
    private readonly workspaces: WorkspaceService,
    private readonly runner: StructuredCommandRunner = new StructuredCommandRunner(),
  ) {}

  public subscribe(taskId: string, listener: CommandListener): () => void {
    const listeners = this.#listeners.get(taskId) ?? new Set<CommandListener>();
    listeners.add(listener);
    this.#listeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(taskId);
      }
    };
  }

  public listForConversation(conversationId: string): ReadonlyArray<CommandExecution> {
    return this.repository.listForConversation(conversationId);
  }

  public listRules(workspaceId: string) {
    return this.rules.list(workspaceId);
  }

  public addRule(workspaceId: string, kind: PermissionRuleKind, value: string) {
    return this.rules.upsert(workspaceId, kind, value);
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
    return this.rules.list(workspaceId);
  }

  public deleteRule(workspaceId: string, ruleId: string): boolean {
    return this.rules.delete(workspaceId, ruleId);
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
        rule.kind === 'deny_executable' && matchesExecutableRule(rule, input.executable, cwd),
    );
    const networkAllowed = rules.some((rule) => rule.kind === 'allow_network_commands');
    const allowListed = rules.some(
      (rule) =>
        rule.kind === 'allow_executable' && matchesExecutableRule(rule, input.executable, cwd),
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
      const approval = this.waitForApproval(command, context.signal);
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
    const pending = this.#pending.get(command.id);
    if (pending === undefined) {
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
        executableRuleValue(command.executable, command.cwd),
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
    this.resolveApproval(command.id, approved ? 'approved' : 'rejected');
    this.emit({ type: 'command_status', command: updated });
    return updated;
  }

  public cancel(commandId: string): boolean {
    const running = this.#running.get(commandId);
    if (running !== undefined) {
      running.abort(new DOMException('Command cancelled by user.', 'AbortError'));
      return true;
    }
    const pending = this.#pending.get(commandId);
    if (pending === undefined) {
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
    this.resolveApproval(commandId, 'cancelled');
    this.emit({ type: 'command_status', command });
    return true;
  }

  public close(): void {
    for (const commandId of [...this.#pending.keys()]) {
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

  private waitForApproval(
    command: CommandExecution,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      const abortListener = () => {
        if (!this.#pending.has(command.id)) {
          return;
        }
        const cancelled = this.repository.update(command.id, {
          status: 'cancelled',
          error: {
            code: 'CANCELLED',
            message: 'The Agent task was cancelled while waiting for command approval.',
            retryable: true,
          },
          completedAt: new Date().toISOString(),
        });
        this.resolveApproval(command.id, 'cancelled');
        this.emit({ type: 'command_status', command: cancelled });
      };
      this.#pending.set(command.id, { resolve, signal, abortListener });
      signal.addEventListener('abort', abortListener, { once: true });
    });
  }

  private resolveApproval(commandId: string, outcome: ApprovalOutcome): void {
    const pending = this.#pending.get(commandId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(commandId);
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.resolve(outcome);
  }

  private emit(event: CommandLifecycleEvent): void {
    const taskId = event.type === 'command_output' ? event.taskId : event.command.taskId;
    for (const listener of this.#listeners.get(taskId) ?? []) {
      listener(event);
    }
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
