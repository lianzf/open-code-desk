import { describe, expect, it } from 'vitest';

import { debugPauseLocationSchema, debugThreadRequestSchema, debugThreadSchema } from './debug';

const sessionId = '00000000-0000-4000-8000-000000000001';

describe('debug DAP identifier contracts', () => {
  it('accepts the zero-valued thread identifier emitted by js-debug', () => {
    expect(debugPauseLocationSchema.parse({ threadId: 0, reason: 'breakpoint' })).toEqual({
      threadId: 0,
      reason: 'breakpoint',
    });
    expect(debugThreadSchema.parse({ id: 0, name: 'Main Thread' })).toEqual({
      id: 0,
      name: 'Main Thread',
    });
    expect(debugThreadRequestSchema.parse({ sessionId, threadId: 0 })).toEqual({
      sessionId,
      threadId: 0,
    });
  });

  it('rejects negative thread identifiers at the IPC trust boundary', () => {
    expect(() => debugPauseLocationSchema.parse({ threadId: -1, reason: 'breakpoint' })).toThrow();
    expect(() => debugThreadSchema.parse({ id: -1, name: 'Main Thread' })).toThrow();
    expect(() => debugThreadRequestSchema.parse({ sessionId, threadId: -1 })).toThrow();
  });
});
