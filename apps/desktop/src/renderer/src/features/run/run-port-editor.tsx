import type { RunPortInspection } from '@open-code-desk/ipc-contracts';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { runConfigurationInputClassName } from './run-configuration-draft';
import { useRunTranslation } from './run-i18n';

interface RunPortEditorProps {
  readonly workspaceId: string;
  readonly port: string;
  readonly electronDebugEndpoint?: boolean;
  onPortChange(port: string): void;
}

export function RunPortEditor({
  workspaceId,
  port,
  electronDebugEndpoint = false,
  onPortChange,
}: RunPortEditorProps) {
  const { t } = useRunTranslation();
  const [inspection, setInspection] = useState<RunPortInspection>();
  const [checking, setChecking] = useState(false);

  const inspectPort = async () => {
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return;
    setChecking(true);
    try {
      setInspection(await window.openCodeDesk.run.inspectPort({ workspaceId, port: portNumber }));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>
            {electronDebugEndpoint ? t('electronRendererDebugPort') : t('servicePortOptional')}
          </span>
          <input
            className={runConfigurationInputClassName}
            type="number"
            min={1}
            max={65_535}
            value={port}
            onChange={(event) => {
              onPortChange(event.target.value);
              setInspection(undefined);
            }}
            placeholder={t('portPlaceholder')}
            data-testid="run-config-port"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={checking || port === ''}
          onClick={() => void inspectPort()}
          data-testid="inspect-run-port"
        >
          {checking ? t('checking') : t('checkPort')}
        </Button>
      </div>

      {!electronDebugEndpoint ? null : (
        <p className="text-xs text-zinc-500">{t('electronRendererDebugPortHelp')}</p>
      )}

      {inspection === undefined ? null : (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            inspection.available
              ? 'border-emerald-900 bg-emerald-950/30 text-emerald-300'
              : 'border-amber-900 bg-amber-950/30 text-amber-200'
          }`}
          data-testid="run-port-inspection"
        >
          <span>
            {inspection.available
              ? t('portAvailable', { port: inspection.port })
              : t('portOccupied', {
                  port: inspection.port,
                  process: inspection.processName ?? t('unknownProcess'),
                  pid: inspection.processId === undefined ? '' : ` (PID ${inspection.processId})`,
                })}
          </span>
          {inspection.available || inspection.processId === undefined ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                const owner = `${inspection.processName ?? t('process')} (PID ${
                  inspection.processId
                })`;
                if (window.confirm(t('terminatePortConfirm', { port: inspection.port, owner }))) {
                  void window.openCodeDesk.run
                    .terminatePortProcess({
                      workspaceId,
                      port: inspection.port,
                      expectedProcessId: inspection.processId!,
                      confirmed: true,
                    })
                    .then(setInspection);
                }
              }}
              data-testid="terminate-run-port-process"
            >
              {t('terminateProcess')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
