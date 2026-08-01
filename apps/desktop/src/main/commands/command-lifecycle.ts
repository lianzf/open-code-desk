import { createHash } from 'node:crypto';

import type { AppError, CommandExecution } from '@open-code-desk/domain';

import type { CommandOutputChunk } from './command-runner';

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

export type ApprovalOutcome = 'approved' | 'rejected' | 'cancelled';
export type CommandListener = (event: CommandLifecycleEvent) => void;

export function commandDigest(input: {
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

export function toToolOutput(command: CommandExecution): CommandToolOutput {
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
