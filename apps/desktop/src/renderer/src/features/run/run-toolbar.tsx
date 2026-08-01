import { CircleStop, Play, RotateCw, Settings2 } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { RunConfigurationDialog } from './run-configuration-dialog';
import { useRunStore } from './run.store';

export interface RunToolbarProps {
  readonly workspaceId: string;
  readonly onShowOutput?: () => void;
}

export function RunToolbar({ workspaceId, onShowOutput }: RunToolbarProps) {
  const configurations = useRunStore((state) => state.configurations);
  const selectedConfigurationId = useRunStore((state) => state.selectedConfigurationId);
  const detection = useRunStore((state) => state.detection);
  const executions = useRunStore((state) => state.executions);
  const selectedExecutionId = useRunStore((state) => state.selectedExecutionId);
  const loading = useRunStore((state) => state.loading);
  const initialize = useRunStore((state) => state.initialize);
  const dispose = useRunStore((state) => state.dispose);
  const selectConfiguration = useRunStore((state) => state.selectConfiguration);
  const saveSuggestion = useRunStore((state) => state.saveSuggestion);
  const proposeStart = useRunStore((state) => state.proposeStart);
  const stop = useRunStore((state) => state.stop);
  const restart = useRunStore((state) => state.restart);
  const openConfigurationDialog = useRunStore((state) => state.openConfigurationDialog);

  useEffect(() => {
    void initialize(workspaceId);
    return dispose;
  }, [dispose, initialize, workspaceId]);

  const selectedExecution = executions.find((execution) => execution.id === selectedExecutionId);
  const activeExecution = executions.find(
    (execution) =>
      execution.configurationId === selectedConfigurationId &&
      ['pending_approval', 'starting', 'running', 'stopping'].includes(execution.status),
  );
  const canStop =
    activeExecution !== undefined && ['starting', 'running'].includes(activeExecution.status);
  const canRestart =
    selectedExecution !== undefined &&
    ['stopped', 'completed', 'failed'].includes(selectedExecution.status);

  return (
    <>
      <div
        className="flex min-w-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/70 p-1"
        aria-label="运行控制"
        data-testid="run-toolbar"
      >
        <select
          className="h-7 min-w-32 max-w-60 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none focus:border-cyan-500"
          value={selectedConfigurationId ?? ''}
          disabled={loading}
          aria-label="运行配置"
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith('suggestion:')) {
              const index = Number(value.slice('suggestion:'.length));
              const suggestion = detection?.suggestedConfigurations[index];
              if (suggestion !== undefined) {
                void saveSuggestion(suggestion);
              }
              return;
            }
            selectConfiguration(value);
          }}
          data-testid="run-configuration-select"
        >
          <option value="" disabled>
            {loading ? '正在检测项目…' : '选择运行配置'}
          </option>
          {configurations.length === 0 ? null : (
            <optgroup label="已保存">
              {configurations.map((configuration) => (
                <option key={configuration.id} value={configuration.id}>
                  {configuration.name}
                </option>
              ))}
            </optgroup>
          )}
          {(detection?.suggestedConfigurations.length ?? 0) === 0 ? null : (
            <optgroup label="检测建议（选择后保存）">
              {detection?.suggestedConfigurations.map((suggestion, index) => (
                <option key={`${suggestion.name}-${index}`} value={`suggestion:${index}`}>
                  {suggestion.name} · {suggestion.executable}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <Button
          type="button"
          size="sm"
          disabled={
            loading || selectedConfigurationId === undefined || activeExecution !== undefined
          }
          onClick={() => {
            void proposeStart().then((execution) => {
              if (execution !== undefined) {
                onShowOutput?.();
              }
            });
          }}
          title="运行（需要批准）"
          data-testid="propose-run"
        >
          <Play className="size-3.5" aria-hidden="true" />
          运行
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canStop}
          onClick={() => {
            if (activeExecution !== undefined) {
              void stop(activeExecution.id);
            }
          }}
          title="停止运行"
          data-testid="stop-run"
        >
          <CircleStop className="size-3.5" aria-hidden="true" />
          停止
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canRestart}
          onClick={() => {
            void restart().then((execution) => {
              if (execution !== undefined) {
                onShowOutput?.();
              }
            });
          }}
          title="重新运行（需要再次批准）"
          data-testid="restart-run"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          重启
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => openConfigurationDialog(selectedConfigurationId)}
          title="编辑运行配置"
          aria-label="编辑运行配置"
          data-testid="open-run-configuration"
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <RunConfigurationDialog />
    </>
  );
}
