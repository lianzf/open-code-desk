import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { translate } from './i18n';

interface UpdatePanelProps {
  readonly locale: Parameters<typeof translate>[0];
}

const phaseTranslation = {
  idle: 'updateIdle',
  checking: 'updateChecking',
  available: 'updateAvailable',
  not_available: 'updateNotAvailable',
  downloading: 'updateDownloading',
  downloaded: 'updateDownloaded',
  error: 'updateError',
  unsupported: 'updateUnsupported',
} as const;

export function UpdatePanel({ locale }: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    void window.openCodeDesk.updates
      .getStatus()
      .then(setStatus)
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : translate(locale, 'updateError'));
      });
    return window.openCodeDesk.updates.onStatusChanged(setStatus);
  }, [locale]);

  const execute = async (action: 'check' | 'download' | 'install') => {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      if (action === 'install') {
        await window.openCodeDesk.updates.install();
      } else {
        setStatus(await window.openCodeDesk.updates[action]());
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('updateError'));
    } finally {
      setBusy(false);
    }
  };

  if (status === undefined) {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
        <LoaderCircle className="size-3.5 animate-spin" />
        {t('updateChecking')}
      </div>
    );
  }

  const canCheck = ['idle', 'not_available', 'error'].includes(status.phase);
  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">
          {t('currentVersion')} {status.currentVersion}
        </span>
        {status.availableVersion === undefined ? null : (
          <span className="rounded bg-cyan-950 px-1.5 py-0.5 text-[10px] text-cyan-300">
            {status.availableVersion}
          </span>
        )}
        <span className="ml-auto text-[11px] text-zinc-500">
          {t(phaseTranslation[status.phase])}
        </span>
      </div>
      {status.phase === 'downloading' ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-cyan-400 transition-[width]"
            style={{ width: `${status.progress ?? 0}%` }}
          />
        </div>
      ) : null}
      {status.message === undefined && errorMessage === undefined ? null : (
        <p className="mt-2 text-[11px] text-red-300">{errorMessage ?? status.message}</p>
      )}
      <div className="mt-3 flex justify-end">
        {canCheck ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void execute('check')}
            data-testid="check-updates"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            {t('checkForUpdates')}
          </Button>
        ) : null}
        {status.phase === 'available' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void execute('download')}
          >
            <Download className="size-3.5" />
            {t('downloadUpdate')}
          </Button>
        ) : null}
        {status.phase === 'downloaded' ? (
          <Button size="sm" disabled={busy} onClick={() => void execute('install')}>
            {t('restartAndInstall')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
