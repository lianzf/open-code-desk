import type { AppError } from '@open-code-desk/domain';
import type { ChatStreamEvent } from '@open-code-desk/provider-core';
import type { ToolResult } from '@open-code-desk/tool-core';

import type { ConversationRepository } from '../conversations/conversation.repository';
import { normalizeProviderError, toPublicAppError } from '../providers/core/provider-error';
import type { AgentEventListener } from './agent.types';

export const maximumAgentRounds = 8;
export const maximumToolCalls = 20;

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

export function unexpectedError(error: unknown): AppError {
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
