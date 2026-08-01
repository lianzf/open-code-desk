import type { DebugBreakpoint } from '@open-code-desk/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { debugBreakpointKind, debugBreakpointTooltip } from './debug-breakpoint-format';

describe('debug breakpoint presentation', () => {
  it('distinguishes line, conditional and log breakpoints', () => {
    expect(debugBreakpointKind(breakpoint())).toBe('line');
    expect(debugBreakpointKind(breakpoint({ hitCondition: '>= 3' }))).toBe('conditional');
    expect(debugBreakpointKind(breakpoint({ logMessage: 'request={request.id}' }))).toBe(
      'logpoint',
    );
  });

  it('explains advanced breakpoint state without hiding adapter errors', () => {
    expect(
      debugBreakpointTooltip(
        breakpoint({
          status: 'unverified',
          condition: 'request.user.id === 42',
          hitCondition: '>= 2',
          message: '无法绑定到可执行代码',
        }),
      ),
    ).toBe(
      [
        '断点：调试器未验证',
        '条件：request.user.id === 42',
        '命中：>= 2',
        '无法绑定到可执行代码',
      ].join('\n\n'),
    );
  });
});

function breakpoint(overrides: Partial<DebugBreakpoint> = {}): DebugBreakpoint {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    workspaceId: '00000000-0000-4000-8000-000000000202',
    relativePath: 'program.js',
    line: 3,
    enabled: true,
    status: 'pending',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.001Z',
    ...overrides,
  };
}
