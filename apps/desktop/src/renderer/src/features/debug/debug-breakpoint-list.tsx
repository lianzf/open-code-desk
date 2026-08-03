import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useEditorStore } from '@/features/editor/editor.store';
import { debugBreakpointKind, debugBreakpointMessage } from './debug-breakpoint-format';
import { useDebugTranslation } from './debug-i18n';
import { DebugSection } from './debug-panel.components';
import {
  ExceptionBreakpointDialog,
  type ExceptionBreakpointEditor,
  SpecialBreakpointDialog,
  type SpecialBreakpointEditor,
} from './debug-special-breakpoint-dialogs';
import { useDebugStore } from './debug.store';

const pauseModeLabels = {
  none: 'noExceptionPause',
  uncaught: 'uncaughtExceptions',
  all: 'allExceptions',
} as const;

const breakpointStatusLabels = {
  pending: 'breakpointPending',
  verified: 'breakpointVerified',
  unverified: 'breakpointUnverified',
  disabled: 'breakpointDisabled',
  error: 'breakpointError',
} as const;

export function DebugBreakpointList({ workspaceId }: { readonly workspaceId: string }) {
  const { locale, t } = useDebugTranslation();
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const settings = useDebugStore((state) => state.settings);
  const exceptionPauseMode = settings?.exceptionPauseMode ?? 'uncaught';
  const setExceptionPauseMode = useDebugStore((state) => state.setExceptionPauseMode);
  const setExceptionPolicy = useDebugStore((state) => state.setExceptionPolicy);
  const deleteAllBreakpoints = useDebugStore((state) => state.deleteAllBreakpoints);
  const setBreakpointEnabled = useDebugStore((state) => state.setBreakpointEnabled);
  const openBreakpointEditor = useDebugStore((state) => state.openBreakpointEditor);
  const deleteBreakpoint = useDebugStore((state) => state.deleteBreakpoint);
  const saveSpecialBreakpoint = useDebugStore((state) => state.saveSpecialBreakpoint);
  const openFileAt = useEditorStore((editor) => editor.openFileAt);
  const [specialEditor, setSpecialEditor] = useState<SpecialBreakpointEditor>();
  const [exceptionEditor, setExceptionEditor] = useState<ExceptionBreakpointEditor>();

  return (
    <DebugSection title={t('breakpoints')}>
      <label className="block border-b border-zinc-900 px-2 py-1.5 text-[9px] text-zinc-600">
        {t('exceptionPause')}
        <select
          className="mt-1 h-7 w-full rounded border border-zinc-800 bg-black px-2 text-[10px] text-zinc-300 outline-none focus:border-cyan-600"
          value={exceptionPauseMode}
          onChange={(event) =>
            void setExceptionPauseMode(event.target.value as 'none' | 'uncaught' | 'all')
          }
          data-testid="debug-exception-pause-mode"
          aria-label={t('exceptionPause')}
        >
          {Object.entries(pauseModeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between border-b border-zinc-900 px-2 py-1.5 text-[9px] text-zinc-600">
        <span>
          {t('exceptionRuleCount', {
            pause: settings?.exceptionBreakTypes.length ?? 0,
            ignore: settings?.exceptionIgnoreTypes.length ?? 0,
          })}
        </span>
        <button
          type="button"
          className="rounded border border-zinc-800 px-2 py-1 hover:border-cyan-800 hover:text-cyan-300"
          onClick={() =>
            setExceptionEditor({
              breakTypes: settings?.exceptionBreakTypes.join('\n') ?? '',
              ignoreTypes: settings?.exceptionIgnoreTypes.join('\n') ?? '',
            })
          }
          data-testid="edit-exception-breakpoints"
        >
          {t('advancedExceptionRules')}
        </button>
      </div>
      <div className="flex gap-1 border-b border-zinc-900 px-2 py-1.5">
        <button
          type="button"
          className="rounded border border-zinc-800 px-2 py-1 text-[9px] text-zinc-500 hover:border-cyan-800 hover:text-cyan-300"
          onClick={() =>
            setSpecialEditor({
              kind: 'function',
              value: '',
              accessType: 'write',
              condition: '',
              hitCondition: '',
            })
          }
          data-testid="add-function-breakpoint"
        >
          {t('addFunctionBreakpoint')}
        </button>
        <button
          type="button"
          className="rounded border border-zinc-800 px-2 py-1 text-[9px] text-zinc-500 hover:border-cyan-800 hover:text-cyan-300"
          onClick={() =>
            setSpecialEditor({
              kind: 'data',
              value: '',
              accessType: 'write',
              condition: '',
              hitCondition: '',
            })
          }
          data-testid="add-data-breakpoint"
        >
          {t('addDataBreakpoint')}
        </button>
      </div>
      {breakpoints.length === 0 ? (
        <p className="px-3 py-2 text-[10px] text-zinc-700">{t('breakpointHint')}</p>
      ) : (
        <div className="flex justify-end border-b border-zinc-900 px-2 py-1">
          <button
            type="button"
            className="text-[9px] text-zinc-600 hover:text-red-300"
            onClick={() => void deleteAllBreakpoints()}
          >
            {t('clearProjectBreakpoints')}
          </button>
        </div>
      )}
      {breakpoints.map((breakpoint) => {
        const kind = debugBreakpointKind(breakpoint);
        const detail =
          breakpoint.functionName ??
          breakpoint.dataId ??
          breakpoint.logMessage ??
          breakpoint.condition ??
          breakpoint.hitCondition;
        const locationLabel =
          breakpoint.kind === 'function'
            ? t('functionLocation', { name: breakpoint.functionName ?? '' })
            : breakpoint.kind === 'data'
              ? t('dataLocation', { id: breakpoint.dataId ?? '' })
              : `${breakpoint.relativePath}:${breakpoint.line}`;
        return (
          <div
            key={breakpoint.id}
            className="group flex w-full items-start gap-1 px-2 py-1 text-[10px] hover:bg-zinc-900"
            data-testid="debug-breakpoint-item"
            data-breakpoint-kind={kind}
          >
            <button
              type="button"
              className={`mt-1 size-2.5 shrink-0 border ${kind === 'logpoint' ? 'rotate-45 border-cyan-500 bg-cyan-500' : kind === 'conditional' ? 'rounded-full border-amber-500 bg-amber-500' : kind === 'function' ? 'rounded-sm border-violet-500 bg-violet-500' : kind === 'data' ? 'rounded-sm border-emerald-500 bg-emerald-500' : 'rounded-full border-red-500 bg-red-500'} ${breakpoint.enabled ? '' : 'opacity-30'} ${breakpoint.status === 'verified' ? '' : 'bg-transparent'}`}
              onClick={() => void setBreakpointEnabled(breakpoint.id, !breakpoint.enabled)}
              title={t('breakpointToggleTitle', {
                action: breakpoint.enabled ? t('disable') : t('enable'),
                status: t(breakpointStatusLabels[breakpoint.status]),
              })}
              aria-label={t('breakpointToggleLabel', {
                action: breakpoint.enabled ? t('disable') : t('enable'),
                location: locationLabel,
              })}
            />
            <button
              type="button"
              className="min-w-0 flex-1 py-0.5 text-left text-zinc-500"
              onClick={() =>
                breakpoint.kind === 'line'
                  ? void openFileAt(
                      workspaceId,
                      breakpoint.relativePath,
                      breakpoint.line,
                      breakpoint.column,
                    )
                  : undefined
              }
              title={`${locationLabel} · ${t(breakpointStatusLabels[breakpoint.status])}`}
              data-breakpoint-status={breakpoint.status}
            >
              <span className="block truncate">{locationLabel}</span>
              {detail === undefined ? null : (
                <span className="block truncate text-[9px] text-zinc-700">{detail}</span>
              )}
              {breakpoint.message === undefined ? null : (
                <span className="block truncate text-[9px] text-amber-700">
                  {debugBreakpointMessage(breakpoint, locale)}
                </span>
              )}
            </button>
            <button
              type="button"
              className="mt-0.5 shrink-0 p-0.5 text-zinc-700 opacity-0 hover:text-cyan-300 group-hover:opacity-100 focus:opacity-100"
              onClick={() => {
                if (breakpoint.kind === 'line') {
                  openBreakpointEditor(breakpoint.relativePath, breakpoint.line, breakpoint.column);
                } else {
                  setSpecialEditor({
                    id: breakpoint.id,
                    kind: breakpoint.kind,
                    value:
                      breakpoint.kind === 'function'
                        ? (breakpoint.functionName ?? '')
                        : (breakpoint.dataId ?? ''),
                    accessType: breakpoint.dataAccessType ?? 'write',
                    condition: breakpoint.condition ?? '',
                    hitCondition: breakpoint.hitCondition ?? '',
                  });
                }
              }}
              aria-label={t('editLocation', { location: locationLabel })}
              data-testid="edit-debug-breakpoint"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              className="mt-0.5 shrink-0 p-0.5 text-zinc-700 opacity-0 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
              onClick={() => void deleteBreakpoint(breakpoint.id)}
              aria-label={t('deleteLineBreakpoint', {
                path: breakpoint.relativePath,
                line: breakpoint.line,
              })}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
      {exceptionEditor === undefined ? null : (
        <ExceptionBreakpointDialog
          initial={exceptionEditor}
          onCancel={() => setExceptionEditor(undefined)}
          onSave={(breakTypes, ignoreTypes) =>
            setExceptionPolicy(breakTypes, ignoreTypes).then(() => setExceptionEditor(undefined))
          }
        />
      )}
      {specialEditor === undefined ? null : (
        <SpecialBreakpointDialog
          initial={specialEditor}
          onCancel={() => setSpecialEditor(undefined)}
          onSave={(draft) => {
            const common = {
              ...(draft.id === undefined ? {} : { id: draft.id }),
              condition: draft.condition,
              hitCondition: draft.hitCondition,
            };
            return saveSpecialBreakpoint(
              draft.kind === 'function'
                ? { ...common, kind: 'function', functionName: draft.value }
                : {
                    ...common,
                    kind: 'data',
                    dataId: draft.value,
                    dataAccessType: draft.accessType,
                  },
            ).then(() => setSpecialEditor(undefined));
          }}
        />
      )}
    </DebugSection>
  );
}
