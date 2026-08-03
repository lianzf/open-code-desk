import { BrainCircuit, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { DebugContextSectionKey, DebugContextSnapshot } from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { useDebugTranslation } from './debug-i18n';

export function DebugContextDialog({
  loading,
  snapshot,
  onClose,
  onConfirm,
}: {
  readonly loading: boolean;
  readonly snapshot: DebugContextSnapshot;
  readonly onClose: () => void;
  readonly onConfirm: (sections: ReadonlyArray<DebugContextSectionKey>) => Promise<void>;
}) {
  const { locale, t } = useDebugTranslation();
  const [selected, setSelected] = useState<ReadonlySet<DebugContextSectionKey>>(
    () =>
      new Set(
        snapshot.sections
          .filter((section) => section.selectedByDefault)
          .map((section) => section.key),
      ),
  );

  const toggle = (key: DebugContextSectionKey) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[65] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('reviewDebugContext')}
      data-testid="debug-context-dialog"
    >
      <section className="flex h-[min(860px,94vh)] w-[min(1000px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 px-5">
          <BrainCircuit className="size-5 text-cyan-400" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">{t('sendToAI')}</h2>
            <p className="text-[11px] text-zinc-500">{t('debugContextDescription')}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
            aria-label={t('closeDebugContextPreview')}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-200">
            <ShieldCheck className="size-4" />
            <span>{t('redactionNotice')}</span>
            <span className="text-emerald-500">·</span>
            <span>
              {t('tokenEstimate', { count: snapshot.totalTokenEstimate.toLocaleString(locale) })}
            </span>
            <span className="text-emerald-500">·</span>
            <span data-testid="debug-context-redactions">
              {t('redactionCount', { count: snapshot.totalRedactionCount })}
            </span>
            <span className="ml-auto text-zinc-500">
              {t('previewExpires', {
                time: new Date(snapshot.expiresAt).toLocaleTimeString(locale),
              })}
            </span>
          </div>

          {snapshot.sections.map((section) => (
            <article
              key={section.key}
              className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50"
            >
              <label className="flex cursor-pointer items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(section.key)}
                  onChange={() => toggle(section.key)}
                  className="accent-cyan-500"
                  data-testid={`debug-context-section-${section.key}`}
                />
                <span className="text-xs font-medium text-zinc-200">{section.title}</span>
                <span className="text-[10px] text-zinc-600">
                  {t('sectionTokenEstimate', { count: section.tokenEstimate })}
                  {section.redactionCount > 0
                    ? t('sectionRedactions', { count: section.redactionCount })
                    : ''}
                  {section.truncated ? t('truncated') : ''}
                </span>
              </label>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-4 text-zinc-400">
                {section.content}
              </pre>
            </article>
          ))}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-zinc-800 px-5 py-3">
          <p className="mr-auto text-[10px] text-zinc-600">{t('untrustedContextNotice')}</p>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void onConfirm([...selected])}
            disabled={loading || selected.size === 0}
            data-testid="debug-context-confirm"
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <BrainCircuit className="size-4" />
            )}
            {t('confirmStartAnalysis')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
