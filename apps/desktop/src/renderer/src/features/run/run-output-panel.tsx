import type { RunExecution, RunRiskLevel } from '@open-code-desk/ipc-contracts';
import { Ban, Check, CircleStop, RotateCw, ShieldAlert, TerminalSquare, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rendererRiskReason } from '@/features/settings/command-risk-i18n';
import { rendererErrorDetail } from '@/features/settings/error-i18n';
import { useRunTranslation } from './run-i18n';
import { useRunStore } from './run.store';

const statusLabels = {
  pending_approval: 'pendingApproval',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  completed: 'completed',
  failed: 'failed',
  rejected: 'rejected',
} as const satisfies Readonly<Record<RunExecution['status'], string>>;

const riskLabels = {
  low: 'lowRisk',
  medium: 'mediumRisk',
  high: 'highRisk',
  blocked: 'blocked',
} as const satisfies Readonly<Record<RunRiskLevel, string>>;

function riskClassName(riskLevel: RunRiskLevel): string {
  if (riskLevel === 'high' || riskLevel === 'blocked') {
    return 'border-red-900/70 bg-red-950/40 text-red-300';
  }
  if (riskLevel === 'medium') {
    return 'border-amber-900/70 bg-amber-950/40 text-amber-300';
  }
  return 'border-zinc-700 bg-zinc-900 text-zinc-400';
}

function commandLabel(execution: RunExecution): string {
  const { executable, runtimeArgs, args } = execution.command;
  return [executable, ...runtimeArgs, ...args]
    .map((part, index) => (index === 0 ? part : JSON.stringify(part)))
    .join(' ');
}

export interface RunOutputPanelProps {
  readonly onClose?: () => void;
}

export function RunOutputPanel({ onClose }: RunOutputPanelProps) {
  const { locale, t } = useRunTranslation();
  const executions = useRunStore((state) => state.executions);
  const selectedExecutionId = useRunStore((state) => state.selectedExecutionId);
  const outputChunks = useRunStore((state) => state.outputChunks);
  const busyExecutionId = useRunStore((state) => state.busyExecutionId);
  const errorMessage = useRunStore((state) => state.errorMessage);
  const selectExecution = useRunStore((state) => state.selectExecution);
  const decideStart = useRunStore((state) => state.decideStart);
  const stop = useRunStore((state) => state.stop);
  const restart = useRunStore((state) => state.restart);

  const execution = executions.find((item) => item.id === selectedExecutionId) ?? executions[0];
  const chunks = execution === undefined ? [] : (outputChunks[execution.id] ?? []);
  const busy = execution !== undefined && busyExecutionId === execution.id;

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-950"
      aria-label={t('runOutput')}
      data-testid="run-output-panel"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <TerminalSquare className="size-4 text-cyan-500" aria-hidden="true" />
        <h2 className="text-xs font-semibold text-zinc-200">{t('runOutput')}</h2>
        <select
          className="ml-2 h-7 min-w-0 max-w-80 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none focus:border-cyan-500"
          value={execution?.id ?? ''}
          onChange={(event) => selectExecution(event.target.value)}
          aria-label={t('runHistory')}
          data-testid="run-history-select"
        >
          {executions.length === 0 ? <option value="">{t('noRunHistory')}</option> : null}
          {executions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.command.configurationName} · {t(statusLabels[item.status])} ·{' '}
              {new Date(item.createdAt).toLocaleString(locale)}
            </option>
          ))}
        </select>
        {execution === undefined ? null : (
          <>
            <span className="ml-auto text-[10px] text-zinc-500">
              {t(statusLabels[execution.status])}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] ${riskClassName(
                execution.riskLevel,
              )}`}
            >
              {t(riskLabels[execution.riskLevel])}
            </span>
          </>
        )}
        {onClose === undefined ? null : (
          <button
            type="button"
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            aria-label={t('closeRunOutput')}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </header>

      {execution === undefined ? (
        <div className="grid min-h-36 place-items-center text-xs text-zinc-600">
          {t('emptyRunHelp')}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(240px,340px)_1fr]">
          <aside className="space-y-3 overflow-auto border-b border-zinc-800 p-3 lg:border-r lg:border-b-0">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] leading-4 text-zinc-300">
              {commandLabel(execution)}
            </pre>
            <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[10px] text-zinc-500">
              <dt>{t('workingDirectory')}</dt>
              <dd className="min-w-0 break-all text-zinc-400">
                {execution.command.workingDirectory || t('workspaceRoot')}
              </dd>
              <dt>{t('processPid')}</dt>
              <dd className="text-zinc-400">{execution.processId ?? '—'}</dd>
              <dt>{t('servicePort')}</dt>
              <dd className="text-zinc-400">{execution.command.port ?? '—'}</dd>
              <dt>{t('status')}</dt>
              <dd className="text-zinc-400">{t(statusLabels[execution.status])}</dd>
              <dt>{t('exitCode')}</dt>
              <dd className="text-zinc-400">{execution.exitCode ?? '—'}</dd>
              <dt>{t('outputBytes')}</dt>
              <dd className="text-zinc-400">
                {execution.outputBytes.toLocaleString(locale)}
                {execution.outputTruncated ? t('truncated') : ''}
              </dd>
            </dl>

            {execution.riskReasons.length === 0 ? null : (
              <ul className="space-y-1 text-[10px] text-zinc-500">
                {execution.riskReasons.map((reason) => (
                  <li key={reason} className="flex gap-1.5">
                    <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    <span>{rendererRiskReason(reason)}</span>
                  </li>
                ))}
              </ul>
            )}

            {[
              [t('preLaunchPlan'), execution.command.preLaunchTaskPlan] as const,
              [t('postRunPlan'), execution.command.postRunTaskPlan] as const,
            ].map(([label, taskPlan]) =>
              taskPlan === undefined ? null : (
                <section
                  key={label}
                  className="rounded border border-zinc-800 bg-black/30 p-2 text-[10px]"
                >
                  <h3 className="font-medium text-zinc-300">
                    {t('taskSteps', { label, count: taskPlan.plan.length })}
                  </h3>
                  <ol className="mt-1 space-y-1 text-zinc-500">
                    {taskPlan.plan.map((step, index) => (
                      <li key={step.taskId}>
                        {index + 1}. {step.taskName} · {step.executable}{' '}
                        {step.args.map((argument) => JSON.stringify(argument)).join(' ')}
                      </li>
                    ))}
                  </ol>
                </section>
              ),
            )}

            {execution.status === 'pending_approval' ? (
              <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-2">
                <p className="text-[10px] leading-4 text-zinc-400">{t('approvalWarning')}</p>
                <code
                  className="mt-1 block truncate text-[9px] text-zinc-600"
                  title={execution.approvalDigest}
                >
                  {t('digest', { value: execution.approvalDigest })}
                </code>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void decideStart(execution.id, 'reject')}
                    data-testid="reject-run"
                  >
                    <Ban className="size-3.5" aria-hidden="true" />
                    {t('reject')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || execution.riskLevel === 'blocked'}
                    onClick={() => void decideStart(execution.id, 'approve')}
                    data-testid="approve-run"
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                    {t('approveRun')}
                  </Button>
                </div>
              </div>
            ) : null}

            {['starting', 'running'].includes(execution.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void stop(execution.id)}
              >
                <CircleStop className="size-3.5" aria-hidden="true" />
                {t('stop')}
              </Button>
            ) : null}
            {['stopped', 'completed', 'failed'].includes(execution.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void restart(execution.id)}
              >
                <RotateCw className="size-3.5" aria-hidden="true" />
                {t('restart')}
              </Button>
            ) : null}
            {execution.error === undefined ? null : (
              <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-[10px] text-red-300">
                {rendererErrorDetail(
                  execution.error.message,
                  execution.error.code,
                  'runOperationFailed',
                )}
              </p>
            )}
          </aside>

          <pre
            className="min-h-36 overflow-auto whitespace-pre-wrap break-all bg-black p-3 font-mono text-[11px] leading-5 text-zinc-300"
            aria-live="polite"
            data-testid="run-output"
          >
            {chunks.length === 0
              ? execution.outputTail || t('waitingOutput')
              : chunks.map((chunk) => (
                  <span
                    key={`${chunk.sequence}-${chunk.stream}`}
                    className={chunk.stream === 'stderr' ? 'text-red-300' : 'text-zinc-300'}
                    data-stream={chunk.stream}
                  >
                    {chunk.data}
                  </span>
                ))}
          </pre>
        </div>
      )}

      {errorMessage === undefined ? null : (
        <p
          className="border-t border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] text-red-300"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
