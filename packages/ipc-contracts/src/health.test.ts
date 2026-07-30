import { describe, expect, it } from 'vitest';

import { healthRequestSchema, healthResponseSchema } from './health';

describe('health IPC contract', () => {
  it('accepts a valid request and response', () => {
    const requestId = 'a5d6f8f9-ec3a-4fb6-87c4-076b90b7d27c';
    const request = healthRequestSchema.parse({ requestId });
    const response = healthResponseSchema.parse({
      requestId,
      status: 'ok',
      version: '0.1.0',
      timestamp: '2026-07-28T00:00:00.000Z',
    });

    expect(response.requestId).toBe(request.requestId);
  });

  it('rejects unknown fields', () => {
    expect(() =>
      healthRequestSchema.parse({
        requestId: 'a5d6f8f9-ec3a-4fb6-87c4-076b90b7d27c',
        channel: 'arbitrary',
      }),
    ).toThrow();
  });
});
