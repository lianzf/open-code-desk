import { ProviderServiceError } from '../core/provider-error';

const maximumEventBytes = 1_000_000;
const maximumStreamBytes = 12_000_000;
const streamIdleTimeoutMs = 30_000;
const maximumStreamDurationMs = 10 * 60_000;

export interface ServerSentEventLimits {
  readonly maximumBytes?: number;
  readonly idleTimeoutMs?: number;
  readonly maximumDurationMs?: number;
}

function streamDurationTimeoutError(): ProviderServiceError {
  return new ProviderServiceError(
    'PROVIDER_UNAVAILABLE',
    '模型服务的流式响应超过最长持续时间。请检查网络和服务状态后重试。',
    true,
  );
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    if (signal.aborted) {
      throw signal.reason;
    }
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new ProviderServiceError(
              'PROVIDER_UNAVAILABLE',
              '模型服务的流式响应超时。请检查网络和服务状态后重试。',
              true,
            ),
          );
        }, timeoutMs);
      }),
      new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(signal.reason);
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (abortListener !== undefined) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  limits: ServerSentEventLimits = {},
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let receivedBytes = 0;
  const maximumBytes = limits.maximumBytes ?? maximumStreamBytes;
  const idleTimeoutMs = limits.idleTimeoutMs ?? streamIdleTimeoutMs;
  const maximumDurationMs = limits.maximumDurationMs ?? maximumStreamDurationMs;
  const deadline = Date.now() + maximumDurationMs;

  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason;
      }
      const remainingDurationMs = deadline - Date.now();
      if (remainingDurationMs <= 0) {
        throw streamDurationTimeoutError();
      }
      const chunk = await readWithIdleTimeout(
        reader,
        Math.min(idleTimeoutMs, remainingDurationMs),
        signal,
      );
      if (chunk.done) {
        buffered += decoder.decode();
        break;
      }
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maximumBytes) {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          '模型服务的流式响应超过原始数据安全限制。',
          false,
        );
      }
      buffered += decoder.decode(chunk.value, { stream: true });
      if (buffered.length > maximumEventBytes * 2) {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          '模型服务返回了超出限制的流式事件。',
          false,
        );
      }

      let boundary = findEventBoundary(buffered);
      while (boundary !== null) {
        const rawEvent = buffered.slice(0, boundary.index);
        buffered = buffered.slice(boundary.index + boundary.length);
        const data = extractData(rawEvent);
        if (data !== null) {
          yield data;
        }
        boundary = findEventBoundary(buffered);
      }
    }

    const data = extractData(buffered);
    if (data !== null) {
      yield data;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(
  value: string,
): { readonly index: number; readonly length: number } | null {
  const lf = value.indexOf('\n\n');
  const crlf = value.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) {
    return null;
  }
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

function extractData(rawEvent: string): string | null {
  if (rawEvent.trim() === '') {
    return null;
  }
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n');
  if (data.length > maximumEventBytes) {
    throw new ProviderServiceError(
      'PROVIDER_UNAVAILABLE',
      '模型服务返回了超出限制的流式事件。',
      false,
    );
  }
  return data;
}
