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
});
