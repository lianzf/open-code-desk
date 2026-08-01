import { describe, expect, it } from 'vitest';

import { DapFrameParser } from './dap-frame-parser';

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

describe('DapFrameParser', () => {
  it('parses fragmented UTF-8 messages and multiple frames', () => {
    const parser = new DapFrameParser();
    const first = frame({ seq: 1, type: 'event', event: 'output', body: { output: '中文' } });
    const second = frame({ seq: 2, type: 'event', event: 'initialized' });
    const combined = Buffer.concat([first, second]);

    expect(parser.push(combined.subarray(0, 17))).toEqual([]);
    expect(parser.push(combined.subarray(17))).toEqual([
      { seq: 1, type: 'event', event: 'output', body: { output: '中文' } },
      { seq: 2, type: 'event', event: 'initialized' },
    ]);
  });

  it('rejects oversized messages before allocating their body', () => {
    const parser = new DapFrameParser();
    expect(() => parser.push(Buffer.from('Content-Length: 99999999\r\n\r\n'))).toThrow('安全限制');
  });
});
