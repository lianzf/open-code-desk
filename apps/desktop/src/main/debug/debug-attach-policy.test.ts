import { describe, expect, it } from 'vitest';

import { assessDebugAttachRisk, isLoopbackHost } from './debug-attach-policy';

describe('debug attach risk policy', () => {
  it.each(['localhost', '127.0.0.1', '127.42.0.9', '::1'])('recognizes loopback host %s', (host) =>
    expect(isLoopbackHost(host)).toBe(true),
  );

  it('requires high-risk approval for a network target', () => {
    expect(
      assessDebugAttachRisk({
        adapter: 'pwa-node',
        environment: 'remote',
        host: 'debug.example.test',
        port: 9229,
      }),
    ).toMatchObject({
      level: 'high',
      reasons: expect.arrayContaining([expect.stringContaining('debug.example.test:9229')]),
    });
  });

  it('marks a locally forwarded container endpoint as medium risk', () => {
    expect(
      assessDebugAttachRisk({
        adapter: 'pwa-node',
        environment: 'container',
        host: '127.0.0.1',
        port: 9230,
      }),
    ).toMatchObject({ level: 'medium' });
  });
});
