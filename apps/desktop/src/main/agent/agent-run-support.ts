import { randomUUID } from 'node:crypto';

import type { AppError, MessageToolCall } from '@open-code-desk/domain';
import type { ChatStreamEvent } from '@open-code-desk/provider-core';
import type { ToolResult } from '@open-code-desk/tool-core';

import type { ConversationRepository } from '../conversations/conversation.repository';
import { normalizeProviderError, toPublicAppError } from '../providers/core/provider-error';
import type { AgentEventListener, AgentRunInput } from './agent.types';
import type { ToolCallRepository } from './tool-call.repository';

export const maximumAgentRounds = 24;
export const maximumToolCalls = 64;

export interface AgentRunLimits {
  readonly maximumAgentRounds: number;
  readonly maximumToolCalls: number;
}

export const defaultAgentRunLimits: AgentRunLimits = {
  maximumAgentRounds,
  maximumToolCalls,
};

export class AgentRunLimitError extends Error {
  public constructor(
    readonly limitKind: 'model_rounds' | 'tool_calls',
    readonly limit: number,
  ) {
    super(
      limitKind === 'tool_calls'
        ? `The Agent reached the ${limit}-tool-call safety limit. Completed progress was saved. Retry to continue from the conversation history.`
        : `The Agent reached the ${limit}-model-round safety limit. Completed progress was saved. Retry to continue from the conversation history.`,
    );
    this.name = 'AgentRunLimitError';
  }
}

const maximumToolResultCharacters = 100_000;

export const rejectedToolErrorCodes = new Set([
  'TOOL_NOT_FOUND',
  'TOOL_INPUT_INVALID',
  'TOOL_PERMISSION_DENIED',
  'TOOL_APPROVAL_REQUIRED',
]);

export interface AccumulatedResponse {
  content: string;
  reasoning: string;
  readonly toolCalls: Map<string, { name: string; arguments: string }>;
}

export function stringifyToolResult(result: ToolResult<unknown>): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    serialized = JSON.stringify({
      ok: false,
      error: {
        code: 'TOOL_RESULT_SERIALIZATION_FAILED',
        message: 'The tool result could not be serialized.',
        retryable: false,
      },
    });
  }
  if (serialized.length <= maximumToolResultCharacters) {
    return serialized;
  }
  return JSON.stringify({
    ok: false,
    error: {
      code: 'TOOL_RESULT_TOO_LARGE',
      message: 'The tool result exceeded the Agent context safety limit. Narrow the request.',
      retryable: true,
    },
  });
}

export function previewOf(result: ToolResult<unknown>): string {
  return stringifyToolResult(result).slice(0, 2_000);
}

export function consumeProviderEvent(
  event: ChatStreamEvent,
  messageId: string,
  response: AccumulatedResponse,
  emit: AgentEventListener,
): void {
  if (event.type === 'text_delta') {
    response.content += event.delta;
    emit({ type: 'text_delta', messageId, delta: event.delta });
  } else if (event.type === 'reasoning_delta') {
    response.reasoning += event.delta;
    emit({ type: 'reasoning_delta', messageId, delta: event.delta });
  } else if (event.type === 'tool_call_start') {
    response.toolCalls.set(event.callId, { name: event.name, arguments: '' });
  } else if (event.type === 'tool_call_delta') {
    const current = response.toolCalls.get(event.callId) ?? { name: '', arguments: '' };
    current.arguments += event.argumentsDelta;
    response.toolCalls.set(event.callId, current);
  } else if (event.type === 'usage') {
    emit({ type: 'usage', messageId, usage: event.usage });
  }
}

export function toolResultStatus(
  result: ToolResult<unknown>,
): 'completed' | 'cancelled' | 'rejected' | 'failed' {
  if (result.ok) return 'completed';
  if (result.error.code === 'CANCELLED') return 'cancelled';
  if (
    rejectedToolErrorCodes.has(result.error.code) ||
    result.error.code === 'TOOL_APPROVAL_REJECTED'
  ) {
    return 'rejected';
  }
  return 'failed';
}

export function addToolResultMessage(
  conversations: ConversationRepository,
  conversationId: string,
  modelCallId: string,
  result: ToolResult<unknown>,
): void {
  conversations.addMessage({
    conversationId,
    role: 'tool',
    content: stringifyToolResult(result),
    toolCallId: modelCallId,
  });
}

export function parseToolArguments(argumentsText: string): unknown {
  if (argumentsText.trim() === '') {
    return {};
  }
  return JSON.parse(argumentsText) as unknown;
}

export function rejectToolCallForBudget(options: {
  readonly input: AgentRunInput;
  readonly taskId: string;
  readonly modelToolCall: MessageToolCall;
  readonly maximumToolCalls: number;
  readonly conversations: ConversationRepository;
  readonly toolCalls: ToolCallRepository;
  readonly emit: AgentEventListener;
}): void {
  const callId = randomUUID();
  const error = {
    code: 'AGENT_TOOL_BUDGET_EXHAUSTED',
    message: `Tool execution was skipped because the Agent reached its ${options.maximumToolCalls}-tool-call safety limit. Retry the task to continue.`,
    retryable: true,
  } as const;
  let untrustedInput: unknown = options.modelToolCall.arguments;
  try {
    untrustedInput = parseToolArguments(options.modelToolCall.arguments);
  } catch {
    // Preserve the original untrusted text for the audit record.
  }
  options.toolCalls.recordRejected(
    {
      id: callId,
      workspaceId: options.input.workspaceId,
      taskId: options.taskId,
      conversationId: options.input.conversationId,
      toolName: options.modelToolCall.name,
      untrustedInput,
    },
    error,
  );
  options.emit({
    type: 'tool_status',
    callId,
    modelCallId: options.modelToolCall.id,
    name: options.modelToolCall.name,
    status: 'rejected',
    input: untrustedInput,
    error,
  });
  addToolResultMessage(
    options.conversations,
    options.input.conversationId,
    options.modelToolCall.id,
    { ok: false, error },
  );
}

export function unexpectedError(error: unknown): AppError {
  if (error instanceof AgentRunLimitError) {
    return {
      code: 'AGENT_BUDGET_EXCEEDED',
      message: error.message,
      retryable: true,
    };
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { code: 'CANCELLED', message: 'The Agent task was cancelled.', retryable: true };
  }
  const normalized = normalizeProviderError(error);
  if (normalized.code !== 'PROVIDER_UNAVAILABLE' || error === normalized) {
    return toPublicAppError(normalized);
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'The Agent task failed unexpectedly.',
    retryable: true,
  };
}
