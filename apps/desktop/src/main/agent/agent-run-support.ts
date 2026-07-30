import type { AppError } from '@open-code-desk/domain';
import type { ToolResult } from '@open-code-desk/tool-core';

import { normalizeProviderError, toPublicAppError } from '../providers/core/provider-error';

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
