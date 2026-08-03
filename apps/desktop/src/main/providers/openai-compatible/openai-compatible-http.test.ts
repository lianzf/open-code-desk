import { describe, expect, it } from 'vitest';

import { readLimitedJson } from './openai-compatible-http';

function responseFromChunks(chunks: ReadonlyArray<string>, close = true): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (close) {
          controller.close();
        }
      },
    }),
  );
}

function responseFromTrickle(chunk: string, delayMs: number): Response {
  const encoded = new TextEncoder().encode(chunk);
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        controller.enqueue(encoded);
      },
    }),
  );
}

describe('bounded provider JSON responses', () => {
  it('rejects a chunked response before buffering beyond the byte limit', async () => {
    await expect(
      readLimitedJson(responseFromChunks(['{"value":', '"too large"}']), {
        maximumBytes: 10,
        idleTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: false });
  });

  it('rejects a response body that stalls after the headers arrive', async () => {
    await expect(
      readLimitedJson(responseFromChunks(['{"value":'], false), {
        maximumBytes: 1_000,
        idleTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });

  it('rejects a trickle response that stays below the idle timeout forever', async () => {
    await expect(
      readLimitedJson(responseFromTrickle(' ', 5), {
        maximumBytes: 1_000,
        idleTimeoutMs: 100,
        maximumDurationMs: 25,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });
});
