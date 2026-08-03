import type { ProjectTaskExecution, RunRiskLevel } from '@open-code-desk/ipc-contracts';
import {
  Ban,
  Check,
  CircleStop,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { rendererRiskReason } from '@/features/settings/command-risk-i18n';
import { rendererErrorDetail } from '@/features/settings/error-i18n';
import { ProjectTaskDialog } from './project-task-dialog';
import { useProjectTaskTranslation } from './project-task-i18n';
import { useProjectTaskStore } from './project-task.store';

const statusLabels = {
  pending_approval: 'pendingApproval',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  completed: 'completed',
  failed: 'failed',
  rejected: 'rejected',
} as const satisfies Readonly<Record<ProjectTaskExecution['status'], string>>;

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

export function ProjectTasksPanel({
  workspaceId,
  onClose,
}: {
  readonly workspaceId: string;
  readonly onClose?: () => void;
}) {
  const { locale, t } = useProjectTaskTranslation();
  const tasks = useProjectTaskStore((state) => state.tasks);
  const selectedTaskId = useProjectTaskStore((state) => state.selectedTaskId);
  const executions = useProjectTaskStore((state) => state.executions);
  const selectedExecutionId = useProjectTaskStore((state) => state.selectedExecutionId);
  const outputChunks = useProjectTaskStore((state) => state.outputChunks);
  const loading = useProjectTaskStore((state) => state.loading);
  const busyExecutionId = useProjectTaskStore((state) => state.busyExecutionId);
  const errorMessage = useProjectTaskStore((state) => state.errorMessage);
  const initialize = useProjectTaskStore((state) => state.initialize);
  const dispose = useProjectTaskStore((state) => state.dispose);
  const selectTask = useProjectTaskStore((state) => state.selectTask);
  const selectExecution = useProjectTaskStore((state) => state.selectExecution);
  const openDialog = useProjectTaskStore((state) => state.openDialog);
  const proposeStart = useProjectTaskStore((state) => state.proposeStart);
  const decideStart = useProjectTaskStore((state) => state.decideStart);
  const stop = useProjectTaskStore((state) => state.stop);
  const restart = useProjectTaskStore((state) => state.restart);

  useEffect(() => {
    void initialize(workspaceId);
    return dispose;
  }, [dispose, initialize, workspaceId]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const execution = executions.find((item) => item.id === selectedExecutionId) ?? executions[0];
  const chunks = execution === undefined ? [] : (outputChunks[execution.id] ?? []);
  const activeExecution = executions.find(
    (item) => item.rootTaskId === selectedTaskId && isActiveStatus(item.status),
  );
  const busy = execution !== undefined && busyExecutionId === execution.id;

  return (
    <>
      <section
        className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-950"
        aria-label={t('projectTasks')}
        data-testid="project-tasks-panel"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-800 px-3">
          <ListChecks className="size-4 shrink-0 text-cyan-500" aria-hidden="true" />
          <h2 className="shrink-0 text-xs font-semibold text-zinc-200">{t('projectTasks')}</h2>
          <select
            className="h-7 min-w-32 max-w-60 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none focus:border-cyan-500"
            value={selectedTaskId ?? ''}
            onChange={(event) => selectTask(event.target.value)}
            aria-label={t('projectTasks')}
            data-testid="project-task-select"
          >
            {tasks.length === 0 ? <option value="">{t('noTasks')}</option> : null}
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name} · {task.type}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openDialog()}
            data-testid="new-project-task"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('new')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={selectedTask === undefined}
            onClick={() => openDialog(selectedTask?.id)}
            data-testid="edit-project-task"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t('edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || selectedTask === undefined || activeExecution !== undefined}
            onClick={() => void proposeStart()}
            data-testid="propose-project-task"
          >
            <Play className="size-3.5" aria-hidden="true" />
            {t('run')}
          </Button>
          {activeExecution === undefined ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={activeExecution.status === 'stopping'}
              onClick={() => void stop(activeExecution.id)}
              data-testid="stop-project-task"
            >
              <CircleStop className="size-3.5" aria-hidden="true" />
              {t('stop')}
            </Button>
          )}
          <select
            className="ml-auto h-7 min-w-0 max-w-72 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none focus:border-cyan-500"
            value={execution?.id ?? ''}
            onChange={(event) => selectExecution(event.target.value)}
            aria-label={t('executionHistory')}
            data-testid="project-task-history-select"
          >
            {executions.length === 0 ? <option value="">{t('noExecutions')}</option> : null}
            {executions.map((item) => {
              const root = item.plan.find((step) => step.taskId === item.rootTaskId);
              return (
                <option key={item.id} value={item.id}>
                  {root?.taskName ?? item.rootTaskId} · {t(statusLabels[item.status])} ·{' '}
                  {new Date(item.createdAt).toLocaleString(locale)}
                </option>
              );
            })}
          </select>
          {onClose === undefined ? null : (
            <button
              type="button"
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={onClose}
              aria-label={t('closeProjectTasks')}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(260px,380px)_1fr]">
          <aside className="space-y-3 overflow-auto border-b border-zinc-800 p-3 lg:border-r lg:border-b-0">
            {selectedTask === undefined ? (
              <p className="text-xs text-zinc-600">{t('createTaskHelp')}</p>
            ) : (
              <div className="rounded border border-zinc-800 bg-black/30 p-2 text-[10px] text-zinc-500">
                <div className="font-medium text-zinc-300">{selectedTask.name}</div>
                <code className="mt-1 block break-all text-zinc-400">
                  {[selectedTask.executable, ...selectedTask.args]
                    .map((part, index) => (index === 0 ? part : JSON.stringify(part)))
                    .join(' ')}
                </code>
                <div className="mt-2">
                  {t('taskDetails', {
                    directory: selectedTask.workingDirectory || t('workspaceRoot'),
                    seconds: Math.round(selectedTask.timeoutMs / 1_000),
                  })}
                </div>
                <div>
                  {t('dependencies', {
                    value:
                      selectedTask.dependsOn.length === 0
                        ? t('none')
                        : selectedTask.dependsOn
                            .map((id) => tasks.find((task) => task.id === id)?.name ?? id)
                            .join(' → '),
                  })}
                </div>
              </div>
            )}

            {execution === undefined ? null : (
              <>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{t(statusLabels[execution.status])}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 ${riskClassName(execution.riskLevel)}`}
                  >
                    {t(riskLabels[execution.riskLevel])}
                  </span>
                  <span>{t('stepCount', { count: execution.plan.length })}</span>
                  <span>PID {execution.processId ?? '—'}</span>
                </div>
                <ol className="space-y-1 rounded border border-zinc-800 bg-black/30 p-2 text-[10px]">
                  {execution.plan.map((step, index) => (
                    <li
                      key={step.taskId}
                      className={
                        step.taskId === execution.currentTaskId ? 'text-cyan-300' : 'text-zinc-500'
                      }
                    >
                      {index + 1}. {step.taskName} · {step.executable}{' '}
                      {step.args.map((argument) => JSON.stringify(argument)).join(' ')}
                    </li>
                  ))}
                </ol>

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

                {execution.status === 'pending_approval' ? (
                  <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-2">
                    <p className="text-[10px] leading-4 text-zinc-400">{t('approvalHelp')}</p>
                    <code className="mt-1 block truncate text-[9px] text-zinc-600">
                      {t('digest', { value: execution.approvalDigest })}
                    </code>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void decideStart(execution.id, 'reject')}
                        data-testid="reject-project-task"
                      >
                        <Ban className="size-3.5" aria-hidden="true" />
                        {t('reject')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || execution.riskLevel === 'blocked'}
                        onClick={() => void decideStart(execution.id, 'approve')}
                        data-testid="approve-project-task"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        {t('approveRun')}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {['stopped', 'completed', 'failed'].includes(execution.status) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void restart(execution.id)}
                    data-testid="restart-project-task"
                  >
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    {t('runAgain')}
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
              </>
            )}
          </aside>

          <pre
            className="min-h-36 overflow-auto whitespace-pre-wrap break-all bg-black p-3 font-mono text-[11px] leading-5 text-zinc-300"
            aria-live="polite"
            data-testid="project-task-output"
          >
            {execution === undefined
              ? t('emptyOutputHelp')
              : chunks.length === 0
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

        {errorMessage === undefined ? null : (
          <p
            className="border-t border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] text-red-300"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </section>
      <ProjectTaskDialog />
    </>
  );
}

function isActiveStatus(status: ProjectTaskExecution['status']): boolean {
  return ['pending_approval', 'starting', 'running', 'stopping'].includes(status);
}
