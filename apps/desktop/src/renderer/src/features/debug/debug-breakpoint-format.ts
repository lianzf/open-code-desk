import type { DebugBreakpoint } from '@open-code-desk/ipc-contracts';

export type DebugBreakpointKind = 'line' | 'conditional' | 'logpoint';

export function debugBreakpointKind(breakpoint: DebugBreakpoint): DebugBreakpointKind {
  if (breakpoint.logMessage !== undefined) return 'logpoint';
  return breakpoint.condition !== undefined || breakpoint.hitCondition !== undefined
    ? 'conditional'
    : 'line';
}

export function debugBreakpointTooltip(breakpoint: DebugBreakpoint): string {
  const status =
    {
      pending: '等待调试器验证',
      verified: '已由调试器验证',
      unverified: '调试器未验证',
      disabled: '已禁用',
      error: '断点错误',
    }[breakpoint.status] ?? breakpoint.status;
  const details = [
    breakpoint.condition === undefined ? undefined : `条件：${breakpoint.condition}`,
    breakpoint.hitCondition === undefined ? undefined : `命中：${breakpoint.hitCondition}`,
    breakpoint.logMessage === undefined ? undefined : `日志：${breakpoint.logMessage}`,
    breakpoint.message,
  ].filter((value): value is string => value !== undefined);
  return [`断点：${status}`, ...details].join('\n\n');
}
