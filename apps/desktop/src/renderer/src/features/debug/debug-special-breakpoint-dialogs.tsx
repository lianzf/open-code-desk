import { useState } from 'react';

import { useDebugTranslation } from './debug-i18n';

export interface ExceptionBreakpointEditor {
  readonly breakTypes: string;
  readonly ignoreTypes: string;
}

export interface SpecialBreakpointEditor {
  readonly id?: string;
  readonly kind: 'function' | 'data';
  readonly value: string;
  readonly accessType: 'read' | 'write' | 'readWrite';
  readonly condition: string;
  readonly hitCondition: string;
}

export function ExceptionBreakpointDialog({
  initial,
  onCancel,
  onSave,
}: {
  readonly initial: ExceptionBreakpointEditor;
  readonly onCancel: () => void;
  readonly onSave: (
    breakTypes: ReadonlyArray<string>,
    ignoreTypes: ReadonlyArray<string>,
  ) => Promise<void>;
}) {
  const { t } = useDebugTranslation();
  const [draft, setDraft] = useState(initial);
  return (
    <div
      className="fixed inset-0 z-[65] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('advancedExceptionRules')}
      data-testid="exception-breakpoint-dialog"
    >
      <form
        className="w-[min(560px,94vw)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(
            parseExceptionTypes(draft.breakTypes),
            parseExceptionTypes(draft.ignoreTypes),
          );
        }}
      >
        <h3 className="text-sm font-medium text-zinc-100">{t('advancedExceptionRules')}</h3>
        <p className="mt-1 text-[10px] leading-4 text-zinc-500">{t('exceptionRuleDescription')}</p>
        <label className="mt-3 block text-xs text-zinc-400">
          {t('pauseSpecificTypes')}
          <textarea
            className="mt-1 min-h-24 w-full rounded border border-zinc-700 bg-black px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500"
            value={draft.breakTypes}
            onChange={(event) =>
              setDraft((current) => ({ ...current, breakTypes: event.target.value }))
            }
            placeholder={'TypeError\nRangeError'}
            data-testid="exception-break-types"
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-400">
          {t('ignoreExceptionTypes')}
          <textarea
            className="mt-1 min-h-24 w-full rounded border border-zinc-700 bg-black px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500"
            value={draft.ignoreTypes}
            onChange={(event) =>
              setDraft((current) => ({ ...current, ignoreTypes: event.target.value }))
            }
            placeholder={'AbortError\nCancelledError'}
            data-testid="exception-ignore-types"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="rounded bg-cyan-400 px-3 py-1.5 text-xs font-medium text-zinc-950"
            data-testid="save-exception-breakpoints"
          >
            {t('saveRules')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SpecialBreakpointDialog({
  initial,
  onCancel,
  onSave,
}: {
  readonly initial: SpecialBreakpointEditor;
  readonly onCancel: () => void;
  readonly onSave: (draft: SpecialBreakpointEditor) => Promise<void>;
}) {
  const { t } = useDebugTranslation();
  const [draft, setDraft] = useState(initial);
  const title = draft.kind === 'function' ? t('functionBreakpoint') : t('dataBreakpoint');
  return (
    <div
      className="fixed inset-0 z-[65] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="special-breakpoint-dialog"
    >
      <form
        className="w-[min(520px,94vw)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft);
        }}
      >
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        <p className="mt-1 text-[10px] leading-4 text-zinc-500">
          {draft.kind === 'function' ? t('functionBreakpointHelp') : t('dataBreakpointHelp')}
        </p>
        <label className="mt-3 block text-xs text-zinc-400">
          {draft.kind === 'function' ? t('functionName') : t('dataId')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-700 bg-black px-3 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500"
            value={draft.value}
            onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
            required
            data-testid="special-breakpoint-value"
          />
        </label>
        {draft.kind === 'function' ? null : (
          <label className="mt-3 block text-xs text-zinc-400">
            {t('accessType')}
            <select
              className="mt-1 h-9 w-full rounded border border-zinc-700 bg-black px-3 text-xs text-zinc-200"
              value={draft.accessType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  accessType: event.target.value as SpecialBreakpointEditor['accessType'],
                }))
              }
              data-testid="data-breakpoint-access-type"
            >
              <option value="write">{t('write')}</option>
              <option value="read">{t('read')}</option>
              <option value="readWrite">{t('readWrite')}</option>
            </select>
          </label>
        )}
        <label className="mt-3 block text-xs text-zinc-400">
          {t('conditionOptional')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-700 bg-black px-3 font-mono text-xs text-zinc-200"
            value={draft.condition}
            onChange={(event) =>
              setDraft((current) => ({ ...current, condition: event.target.value }))
            }
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-400">
          {t('hitConditionOptional')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-700 bg-black px-3 font-mono text-xs text-zinc-200"
            value={draft.hitCondition}
            onChange={(event) =>
              setDraft((current) => ({ ...current, hitCondition: event.target.value }))
            }
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="rounded bg-cyan-400 px-3 py-1.5 text-xs font-medium text-zinc-950"
            data-testid="save-special-breakpoint"
          >
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function parseExceptionTypes(value: string): ReadonlyArray<string> {
  return [
    ...new Set(
      value
        .split(/[\n,]/u)
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
  ];
}
