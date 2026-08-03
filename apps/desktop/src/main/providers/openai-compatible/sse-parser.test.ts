import { describe, expect, it } from 'vitest';

import { parseServerSentEvents } from './sse-parser';

function streamChunks(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function trickleStream(chunk: string, delayMs: number): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(chunk);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(encoded);
    },
  });
}

describe('parseServerSentEvents', () => {
  it('reassembles split Unicode and CRLF-framed events', async () => {
    const bytes = new TextEncoder().encode('data: {"text":"你好"}\r\n\r\ndata: [DONE]\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17, 22));
        controller.enqueue(bytes.slice(22));
        controller.close();
      },
    });

    const events: string[] = [];
    for await (const event of parseServerSentEvents(stream, new AbortController().signal)) {
      events.push(event);
    }

    expect(events).toEqual(['{"text":"你好"}', '[DONE]']);
  });

  it('joins multiple data fields according to the SSE format', async () => {
    const events: string[] = [];
    for await (const event of parseServerSentEvents(
      streamChunks(['data: first\ndata: second\n\n']),
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual(['first\nsecond']);
  });

  it('counts raw framing and comments toward the total stream limit', async () => {
    const consume = async () => {
      for await (const event of parseServerSentEvents(
        streamChunks([': ignored-padding\n\n', ': more-padding\n\n']),
        new AbortController().signal,
        { maximumBytes: 20, idleTimeoutMs: 100 },
      )) {
        // The input intentionally contains no data events.
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    });
  });

  it('rejects a stream that stalls after response headers', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': connected\n\n'));
      },
    });
    const consume = async () => {
      for await (const event of parseServerSentEvents(stream, new AbortController().signal, {
        maximumBytes: 1_000,
        idleTimeoutMs: 10,
      })) {
        // The input intentionally contains no data events.
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('rejects a trickle stream that stays below the idle timeout forever', async () => {
    const consume = async () => {
      for await (const event of parseServerSentEvents(
        trickleStream(': keep-alive\n\n', 5),
        new AbortController().signal,
        {
          maximumBytes: 1_000,
          idleTimeoutMs: 100,
          maximumDurationMs: 25,
        },
      )) {
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });
});
