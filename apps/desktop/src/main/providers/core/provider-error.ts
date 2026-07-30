import type { AppError, AppErrorCode } from '@open-code-desk/domain';

export class ProviderServiceError extends Error {
  public constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderServiceError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function normalizeProviderError(error: unknown): ProviderServiceError {
  if (error instanceof ProviderServiceError) {
    return error;
  }
  if (isAbortError(error)) {
    return new ProviderServiceError('CANCELLED', '请求已停止。你可以调整内容后重新发送。', true);
  }
  return new ProviderServiceError(
    'PROVIDER_UNAVAILABLE',
    '无法连接模型服务。请检查 Base URL、网络连接和服务状态后重试。',
    true,
  );
}

export function toPublicAppError(error: unknown): AppError {
  const normalized = normalizeProviderError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
  };
}

export function errorForHttpStatus(status: number): ProviderServiceError {
  if (status === 401 || status === 403) {
    return new ProviderServiceError(
      'PROVIDER_AUTH_FAILED',
      '模型服务拒绝了凭据。请检查 API Key、账号权限和自定义认证请求头。',
      false,
    );
  }
  if (status === 404) {
    return new ProviderServiceError(
      'MODEL_NOT_FOUND',
      '模型或 API 端点不存在。请检查 Base URL 和 Model ID。',
      false,
    );
  }
  if (status === 408 || status === 429) {
    return new ProviderServiceError(
      status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
      status === 429
        ? '模型服务触发了频率限制。请稍后重试或更换模型。'
        : '模型服务请求超时。请检查网络后重试。',
      true,
    );
  }
  if (status === 413) {
    return new ProviderServiceError(
      'CONTEXT_TOO_LARGE',
      '发送的上下文超过模型服务限制。请减少上下文后重试。',
      false,
    );
  }
  if (status >= 500) {
    return new ProviderServiceError(
      'PROVIDER_UNAVAILABLE',
      `模型服务暂时不可用（HTTP ${status}）。请稍后重试。`,
      true,
    );
  }
  return new ProviderServiceError(
    'PROVIDER_UNAVAILABLE',
    `模型服务拒绝了请求（HTTP ${status}）。请检查模型配置后重试。`,
    false,
  );
}
