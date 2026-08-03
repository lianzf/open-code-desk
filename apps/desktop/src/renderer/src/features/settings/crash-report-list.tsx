import { Check, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CrashReport } from '@open-code-desk/ipc-contracts';

import { translate } from './i18n';
import { localizeMainProcessError } from './main-process-error-i18n';

interface CrashReportListProps {
  readonly locale: Parameters<typeof translate>[0];
}

export function CrashReportList({ locale }: CrashReportListProps) {
  const [reports, setReports] = useState<ReadonlyArray<CrashReport>>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    void window.openCodeDesk.crashReports
      .list({ limit: 10 })
      .then(setReports)
      .catch((error: unknown) => {
        const fallback = translate(locale, 'crashReports');
        setErrorMessage(
          error instanceof Error
            ? localizeMainProcessError(locale, error.message, undefined, fallback)
            : fallback,
        );
      });
  }, [locale]);

  const acknowledge = async (reportId: string) => {
    try {
      const result = await window.openCodeDesk.crashReports.acknowledge({ reportId });
      if (result.acknowledged) {
        setReports((items) =>
          items?.map((item) =>
            item.id === reportId ? { ...item, acknowledgedAt: new Date().toISOString() } : item,
          ),
        );
      }
    } catch (error) {
      const fallback = translate(locale, 'crashReports');
      setErrorMessage(
        error instanceof Error
          ? localizeMainProcessError(locale, error.message, undefined, fallback)
          : fallback,
      );
    }
  };

  return (
    <div className="mt-4 border-t border-zinc-800 pt-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
        <TriangleAlert className="size-3.5 text-amber-400" />
        {t('crashReports')}
      </p>
      {errorMessage === undefined ? null : (
        <p className="text-[11px] text-red-300">{errorMessage}</p>
      )}
      {reports?.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{t('noCrashReports')}</p>
      ) : (
        <div className="max-h-36 space-y-1.5 overflow-auto">
          {reports?.map((report) => (
            <div
              key={report.id}
              className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-[11px]"
            >
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                {report.processType}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">{report.reason}</span>
              <time className="text-zinc-600">
                {new Date(report.createdAt).toLocaleString(locale)}
              </time>
              {report.acknowledgedAt === undefined ? (
                <button
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-300"
                  onClick={() => void acknowledge(report.id)}
                  title={t('acknowledge')}
                >
                  <Check className="size-3.5" />
                </button>
              ) : (
                <Check className="size-3.5 text-emerald-400" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
