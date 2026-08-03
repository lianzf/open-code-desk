import type { DebugBreakpoint } from '@open-code-desk/ipc-contracts';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDebugTranslation } from './debug-i18n';
import type { DebugBreakpointEditorTarget } from './debug-store.types';
import { useDebugStore } from './debug.store';

export function DebugBreakpointDialog() {
  const target = useDebugStore((state) => state.breakpointEditor);
  const breakpoint = useDebugStore((state) =>
    state.breakpoints.find(
      (item) =>
        item.relativePath === state.breakpointEditor?.relativePath &&
        item.line === state.breakpointEditor.line &&
        (item.column ?? 1) === (state.breakpointEditor.column ?? 1),
    ),
  );
  if (target === undefined) return null;

  return (
    <DebugBreakpointForm
      key={`${target.relativePath}:${target.line}:${target.column ?? 1}`}
      target={target}
      breakpoint={breakpoint}
    />
  );
}

function DebugBreakpointForm({
  target,
  breakpoint,
}: {
  readonly target: DebugBreakpointEditorTarget;
  readonly breakpoint: DebugBreakpoint | undefined;
}) {
  const { t } = useDebugTranslation();
  const close = useDebugStore((state) => state.closeBreakpointEditor);
  const save = useDebugStore((state) => state.saveBreakpointDefinition);
  const [condition, setCondition] = useState(() => breakpoint?.condition ?? '');
  const [hitCondition, setHitCondition] = useState(() => breakpoint?.hitCondition ?? '');
  const [logMessage, setLogMessage] = useState(() => breakpoint?.logMessage ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="debug-breakpoint-dialog-title"
      data-testid="debug-breakpoint-dialog"
    >
      <form
        className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void save({
            ...target,
            ...(condition.trim() === '' ? {} : { condition }),
            ...(hitCondition.trim() === '' ? {} : { hitCondition }),
            ...(logMessage.trim() === '' ? {} : { logMessage }),
          }).finally(() => setSaving(false));
        }}
      >
        <h2 id="debug-breakpoint-dialog-title" className="text-sm font-semibold text-zinc-100">
          {t('editBreakpoint', { path: target.relativePath, line: target.line })}
        </h2>
        <p className="mt-1 text-[11px] text-zinc-500">{t('breakpointEditHelp')}</p>

        <label className="mt-4 block text-xs text-zinc-400">
          {t('conditionExpression')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-800 bg-black px-3 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            placeholder={t('conditionPlaceholder')}
            maxLength={4_000}
            autoFocus
            data-testid="debug-breakpoint-condition"
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-400">
          {t('hitCount')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-800 bg-black px-3 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
            value={hitCondition}
            onChange={(event) => setHitCondition(event.target.value)}
            placeholder={t('hitCountPlaceholder')}
            maxLength={1_000}
            data-testid="debug-breakpoint-hit-condition"
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-400">
          {t('logMessage')}
          <input
            className="mt-1 h-9 w-full rounded border border-zinc-800 bg-black px-3 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
            value={logMessage}
            onChange={(event) => setLogMessage(event.target.value)}
            placeholder={t('logMessagePlaceholder')}
            maxLength={4_000}
            data-testid="debug-breakpoint-log-message"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving} data-testid="save-debug-breakpoint">
            {saving ? t('saving') : t('saveBreakpoint')}
          </Button>
        </div>
      </form>
    </div>
  );
}
