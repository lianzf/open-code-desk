import type { AppSettings, DebugBreakpoint } from '@open-code-desk/ipc-contracts';

import { currentRendererLocale } from '../settings/error-i18n';
import { localizeMainProcessError } from '../settings/main-process-error-i18n';
import { translateDebug } from './debug-i18n';

export type DebugBreakpointKind = 'line' | 'conditional' | 'logpoint' | 'function' | 'data';

export function debugBreakpointKind(breakpoint: DebugBreakpoint): DebugBreakpointKind {
  if (breakpoint.kind === 'function' || breakpoint.kind === 'data') return breakpoint.kind;
  if (breakpoint.logMessage !== undefined) return 'logpoint';
  return breakpoint.condition !== undefined || breakpoint.hitCondition !== undefined
    ? 'conditional'
    : 'line';
}

export function debugBreakpointTooltip(
  breakpoint: DebugBreakpoint,
  locale: AppSettings['locale'] = currentRendererLocale(),
): string {
  const statusKey = {
    pending: 'breakpointPending',
    verified: 'breakpointVerified',
    unverified: 'breakpointUnverified',
    disabled: 'breakpointDisabled',
    error: 'breakpointError',
  } as const;
  const status = translateDebug(locale, statusKey[breakpoint.status]);
  const details = [
    breakpoint.condition === undefined
      ? undefined
      : translateDebug(locale, 'conditionDetail', { value: breakpoint.condition }),
    breakpoint.hitCondition === undefined
      ? undefined
      : translateDebug(locale, 'hitDetail', { value: breakpoint.hitCondition }),
    breakpoint.logMessage === undefined
      ? undefined
      : translateDebug(locale, 'logDetail', { value: breakpoint.logMessage }),
    breakpoint.functionName === undefined
      ? undefined
      : translateDebug(locale, 'functionDetail', { value: breakpoint.functionName }),
    breakpoint.dataId === undefined
      ? undefined
      : translateDebug(locale, 'dataIdDetail', { value: breakpoint.dataId }),
    debugBreakpointMessage(breakpoint, locale),
  ].filter((value): value is string => value !== undefined);
  return [translateDebug(locale, 'breakpointTooltip', { status }), ...details].join('\n\n');
}

export function debugBreakpointMessage(
  breakpoint: DebugBreakpoint,
  locale: AppSettings['locale'] = currentRendererLocale(),
): string | undefined {
  if (breakpoint.message === undefined) return undefined;
  return localizeMainProcessError(
    locale,
    breakpoint.message,
    undefined,
    translateDebug(locale, 'breakpointError'),
  );
}
