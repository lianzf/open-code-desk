import { ProviderServiceError } from '../core/provider-error';

const maximumEventBytes = 1_000_000;

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        buffered += decoder.decode();
        break;
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
