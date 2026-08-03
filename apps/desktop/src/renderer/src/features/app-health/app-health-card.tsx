import { CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useAppHealthStore } from '@/features/app-health/app-health.store';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';

export function AppHealthCard() {
  const { check, errorMessage, response, status } = useAppHealthStore();
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(locale, key, values);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
            Desktop bridge
          </p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-50">
            {t('secureCommunicationStatus')}
          </h2>
        </div>
        {status === 'checking' ? (
          <LoaderCircle className="size-5 animate-spin text-zinc-400" aria-hidden="true" />
        ) : status === 'healthy' ? (
          <CheckCircle2 className="size-5 text-emerald-400" aria-hidden="true" />
        ) : (
          <ShieldAlert className="size-5 text-amber-400" aria-hidden="true" />
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-400" data-testid="health-status">
        {status === 'checking'
          ? t('checkingMainProcess')
          : status === 'healthy'
            ? t('mainProcessHealthy', { version: response?.version ?? 'unknown' })
            : errorMessage}
      </p>

      {status === 'unavailable' ? (
        <Button className="mt-4" variant="outline" size="sm" onClick={() => void check()}>
          {t('checkAgain')}
        </Button>
      ) : null}
    </section>
  );
}
