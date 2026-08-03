import { Check, Layers3, Play, Square, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { runConfigurationInputClassName } from './run-configuration-draft';
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
} as const;

const riskLabels = {
  low: 'lowRisk',
  medium: 'mediumRisk',
  high: 'highRisk',
  blocked: 'blocked',
} as const;

export function CompoundRunDialog() {
  const { t } = useRunTranslation();
  const open = useRunStore((state) => state.compoundDialogOpen);
  const configurations = useRunStore((state) => state.configurations);
  const compounds = useRunStore((state) => state.compoundConfigurations);
  const sessions = useRunStore((state) => state.compoundSessions);
  const executions = useRunStore((state) => state.executions);
  const loading = useRunStore((state) => state.loading);
  const errorMessage = useRunStore((state) => state.errorMessage);
  const close = useRunStore((state) => state.closeCompoundDialog);
  const save = useRunStore((state) => state.saveCompoundConfiguration);
  const remove = useRunStore((state) => state.deleteCompoundConfiguration);
  const propose = useRunStore((state) => state.proposeCompoundStart);
  const stopCompound = useRunStore((state) => state.stopCompound);
  const stop = useRunStore((state) => state.stop);
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState('');
  const [configurationIds, setConfigurationIds] = useState<ReadonlyArray<string>>([]);
  const [stopAllOnSingleFailure, setStopAllOnSingleFailure] = useState(true);

  if (!open) return null;

  const resetDraft = () => {
    setEditingId(undefined);
    setName('');
    setConfigurationIds([]);
    setStopAllOnSingleFailure(true);
  };

  return (
    <div
      className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('compoundRun')}
      data-testid="compound-run-dialog"
    >
      <section className="flex max-h-[94vh] w-[min(900px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
          <Layers3 className="mr-2 size-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t('compoundConfiguration')}</h2>
            <p className="text-[11px] text-zinc-500">{t('compoundDescription')}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={close}
            aria-label={t('closeCompound')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[280px_1fr]">
          <aside className="min-h-0 overflow-auto border-b border-zinc-800 p-3 md:border-r md:border-b-0">
            <Button type="button" variant="outline" className="w-full" onClick={resetDraft}>
              {t('newCompound')}
            </Button>
            <div className="mt-3 space-y-2">
              {compounds.map((compound) => (
                <button
                  key={compound.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left ${
                    compound.id === editingId
                      ? 'border-cyan-700 bg-cyan-950/30'
                      : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'
                  }`}
                  onClick={() => {
                    setEditingId(compound.id);
                    setName(compound.name);
                    setConfigurationIds(compound.configurationIds);
                    setStopAllOnSingleFailure(compound.stopAllOnSingleFailure);
                  }}
                  data-testid={`compound-run-item-${compound.id}`}
                >
                  <span className="block text-xs font-medium text-zinc-200">{compound.name}</span>
                  <span className="mt-1 block text-[10px] text-zinc-500">
                    {t('serviceCount', { count: compound.configurationIds.length })} ·{' '}
                    {compound.stopAllOnSingleFailure
                      ? t('stopAllOnFailure')
                      : t('independentFailure')}
                  </span>
                </button>
              ))}
              {compounds.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-zinc-600">{t('noCompound')}</p>
              ) : null}
            </div>
          </aside>

          <main className="min-h-0 space-y-4 overflow-auto p-5">
            <label className="block space-y-1.5 text-xs text-zinc-400">
              <span>{t('compoundName')}</span>
              <input
                className={runConfigurationInputClassName}
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-testid="compound-run-name"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs text-zinc-400">{t('selectTwoServices')}</legend>
              {configurations.map((configuration) => (
                <label
                  key={configuration.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={configurationIds.includes(configuration.id)}
                    onChange={(event) =>
                      setConfigurationIds((current) =>
                        event.target.checked
                          ? [...current, configuration.id]
                          : current.filter((id) => id !== configuration.id),
                      )
                    }
                    data-testid={`compound-run-service-${configuration.id}`}
                  />
                  <span>{configuration.name}</span>
                  <span className="ml-auto text-[10px] text-zinc-500">
                    {configuration.port === undefined
                      ? t('noDeclaredPort')
                      : t('port', { port: configuration.port })}
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={stopAllOnSingleFailure}
                onChange={(event) => setStopAllOnSingleFailure(event.target.checked)}
                data-testid="compound-run-stop-on-failure"
              />
              {t('stopOtherServices')}
            </label>

            <div className="flex flex-wrap gap-2">
              {editingId === undefined ? null : (
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-300"
                  disabled={loading}
                  onClick={() => {
                    if (window.confirm(t('deleteCompoundConfirm', { name }))) {
                      void remove(editingId).then(resetDraft);
                    }
                  }}
                  data-testid="delete-compound-run"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  {t('delete')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={loading || name.trim() === '' || configurationIds.length < 2}
                onClick={() =>
                  void save({
                    ...(editingId === undefined ? {} : { id: editingId }),
                    name,
                    configurationIds,
                    stopAllOnSingleFailure,
                  }).then((saved) => setEditingId(saved.id))
                }
                data-testid="save-compound-run"
              >
                {t('saveCompound')}
              </Button>
              {editingId === undefined ? null : (
                <Button
                  type="button"
                  disabled={loading}
                  onClick={() => void propose(editingId)}
                  data-testid="propose-compound-run"
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  {t('startAll')}
                </Button>
              )}
            </div>

            {sessions.length === 0 ? null : (
              <section className="space-y-2 border-t border-zinc-800 pt-4">
                <h3 className="text-xs font-medium text-zinc-300">{t('activeCompoundRuns')}</h3>
                {sessions.map((session) => {
                  const children = session.executionIds.flatMap((executionId) => {
                    const execution = executions.find((candidate) => candidate.id === executionId);
                    return execution === undefined ? [] : [execution];
                  });
                  const active = children.some((execution) =>
                    ['pending_approval', 'starting', 'running', 'stopping'].includes(
                      execution.status,
                    ),
                  );
                  return (
                    <div
                      key={session.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
                      data-testid={`compound-run-session-${session.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-zinc-200">
                          {session.compoundConfigurationName}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          disabled={!active || loading}
                          onClick={() => void stopCompound(session.id)}
                          data-testid="stop-compound-run"
                        >
                          <Square className="size-3" aria-hidden="true" />
                          {t('stopAll')}
                        </Button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {children.map((execution) => (
                          <div
                            key={execution.id}
                            className="flex items-center text-[10px] text-zinc-500"
                          >
                            <span className="text-zinc-300">
                              {execution.command.configurationName}
                            </span>
                            <span className="ml-2">{t(statusLabels[execution.status])}</span>
                            <button
                              type="button"
                              className="ml-auto text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
                              disabled={
                                loading ||
                                !['pending_approval', 'starting', 'running', 'stopping'].includes(
                                  execution.status,
                                )
                              }
                              onClick={() => void stop(execution.id)}
                            >
                              {t('stop')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {errorMessage === undefined ? null : (
              <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {errorMessage}
              </p>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

export function CompoundRunApprovalDialog() {
  const { t } = useRunTranslation();
  const proposal = useRunStore((state) => state.pendingCompoundProposal);
  const loading = useRunStore((state) => state.loading);
  const decide = useRunStore((state) => state.decideCompound);
  if (proposal === undefined) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('approveCompoundRun')}
      data-testid="compound-run-approval"
    >
      <section className="max-h-[90vh] w-[min(760px,96vw)] overflow-auto rounded-2xl border border-cyan-900 bg-zinc-900 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-zinc-100">
          {t('approveCompoundNamed', { name: proposal.session.compoundConfigurationName })}
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{t('reviewCompound')}</p>
        <div className="mt-4 space-y-3">
          {proposal.executions.map((execution) => (
            <article
              key={execution.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
            >
              <div className="flex items-center gap-2 text-xs text-zinc-200">
                <Check className="size-3.5 text-cyan-400" aria-hidden="true" />
                <span className="font-medium">{execution.command.configurationName}</span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  {execution.command.port === undefined
                    ? t('noDeclaredPort')
                    : t('port', { port: execution.command.port })}
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-300">
                {[
                  execution.command.executable,
                  ...execution.command.runtimeArgs,
                  ...execution.command.args,
                ]
                  .map((value) => JSON.stringify(value))
                  .join(' ')}
              </pre>
              <p className="mt-1 text-[10px] text-zinc-600">
                {execution.command.workingDirectory || t('workspaceRoot')} ·{' '}
                {t(riskLabels[execution.riskLevel])}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void decide('reject')}
            data-testid="reject-compound-run"
          >
            {t('rejectAll')}
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={() => void decide('approve')}
            data-testid="approve-compound-run"
          >
            {t('approveConcurrentStart')}
          </Button>
        </div>
      </section>
    </div>
  );
}
