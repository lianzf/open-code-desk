import type { AuditEvent } from '@open-code-desk/ipc-contracts';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { localizeMainProcessError } from '@/features/settings/main-process-error-i18n';
import { translateAudit, useAuditTranslation } from './audit-i18n';

interface AuditPanelProps {
  readonly workspaceId: string;
  readonly onClose: () => void;
}

const outcomeLabels = {
  requested: 'requested',
  allowed: 'allowed',
  denied: 'denied',
  started: 'started',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Readonly<Record<AuditEvent['outcome'], string>>;

function outcomeClass(outcome: AuditEvent['outcome']): string {
  if (outcome === 'failed' || outcome === 'denied') {
    return 'text-red-400';
  }
  if (outcome === 'succeeded' || outcome === 'allowed') {
    return 'text-emerald-400';
  }
  return 'text-amber-400';
}

export function AuditPanel({ workspaceId, onClose }: AuditPanelProps) {
  const { locale, t } = useAuditTranslation();
  const [events, setEvents] = useState<ReadonlyArray<AuditEvent>>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      setEvents(await window.openCodeDesk.audit.list({ workspaceId, limit: 200 }));
    } catch (error) {
      const fallback = translateAudit(locale, 'readFailed');
      setErrorMessage(
        error instanceof Error
          ? localizeMainProcessError(locale, error.message, undefined, fallback)
          : fallback,
      );
    } finally {
      setLoading(false);
    }
  }, [locale, workspaceId]);

  useEffect(() => {
    let active = true;
    void window.openCodeDesk.audit
      .list({ workspaceId, limit: 200 })
      .then((result) => {
        if (active) {
          setEvents(result);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const fallback = translateAudit(locale, 'readFailed');
          setErrorMessage(
            error instanceof Error
              ? localizeMainProcessError(locale, error.message, undefined, fallback)
              : fallback,
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [locale, workspaceId]);

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-950"
      data-testid="audit-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]">
        <ShieldCheck className="size-3.5 text-cyan-500" />
        <span className="font-medium text-zinc-300">{t('auditLog')}</span>
        <span className="text-zinc-600">{t('recentEvents', { count: events.length })}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t('refreshAudit')}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            aria-label={t('closeAudit')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>
      {errorMessage === undefined ? null : (
        <p className="border-b border-red-950 bg-red-950/40 px-3 py-1 text-[11px] text-red-300">
          {errorMessage}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 && !loading ? (
          <div className="grid h-full place-items-center text-xs text-zinc-600">
            {t('noEvents')}
          </div>
        ) : (
          events.map((event) => (
            <article
              key={event.id}
              className="grid grid-cols-[140px_72px_100px_1fr] gap-2 border-b border-zinc-900 px-3 py-1.5 text-[10px]"
            >
              <time className="text-zinc-600">
                {new Date(event.createdAt).toLocaleString(locale)}
              </time>
              <span className={outcomeClass(event.outcome)}>{t(outcomeLabels[event.outcome])}</span>
              <code className="truncate text-cyan-500">{event.action}</code>
              <span className="truncate text-zinc-400" title={event.summary}>
                {event.summary}
              </span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
