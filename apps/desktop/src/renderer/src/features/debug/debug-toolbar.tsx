import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  CircleStop,
  CornerDownLeft,
  Crosshair,
  Pause,
  Play,
  RotateCw,
  StepForward,
} from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/features/editor/editor.store';
import { useRunStore } from '@/features/run/run.store';
import { useDebugTranslation } from './debug-i18n';
import { useDebugStore } from './debug.store';

export interface DebugToolbarProps {
  readonly workspaceId: string;
  readonly onShowDebug: () => void;
}

export function DebugToolbar({ workspaceId, onShowDebug }: DebugToolbarProps) {
  const { t } = useDebugTranslation();
  const selectedConfigurationId = useRunStore((state) => state.selectedConfigurationId);
  const initialize = useDebugStore((state) => state.initialize);
  const dispose = useDebugStore((state) => state.dispose);
  const sessions = useDebugStore((state) => state.sessions);
  const selectedSessionId = useDebugStore((state) => state.selectedSessionId);
  const loading = useDebugStore((state) => state.loading);
  const proposeStart = useDebugStore((state) => state.proposeStart);
  const stop = useDebugStore((state) => state.stop);
  const restart = useDebugStore((state) => state.restart);
  const control = useDebugStore((state) => state.control);
  const openFileAt = useEditorStore((state) => state.openFileAt);

  useEffect(() => {
    void initialize(workspaceId);
    return dispose;
  }, [dispose, initialize, workspaceId]);

  const selected = sessions.find((session) => session.id === selectedSessionId);
  const active = sessions.find((session) =>
    ['pending_approval', 'starting', 'running', 'paused', 'stopping'].includes(session.status),
  );
  const paused = active?.status === 'paused';

  return (
    <div
      className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/70 p-1"
      aria-label={t('debugControls')}
      data-testid="debug-toolbar"
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={loading || selectedConfigurationId === undefined || active !== undefined}
        onClick={() => {
          if (selectedConfigurationId !== undefined) {
            void proposeStart(selectedConfigurationId).then((session) => {
              if (session !== undefined) onShowDebug();
            });
          }
        }}
        title={t('startDebugRequiresApproval')}
        data-testid="propose-debug"
      >
        <Bug className="size-3.5" aria-hidden="true" />
        {t('debug')}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={loading || active === undefined || !['running', 'paused'].includes(active.status)}
        onClick={() => void control(paused ? 'continue' : 'pause')}
        title={paused ? t('continue') : t('pause')}
        aria-label={paused ? t('continueDebug') : t('pauseDebug')}
        data-testid="debug-toggle-pause"
      >
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </Button>
      <DebugStepButton
        testId="debug-next"
        title={t('stepOver')}
        disabled={loading || !paused}
        onClick={() => void control('next')}
      >
        <StepForward className="size-3.5" />
      </DebugStepButton>
      <DebugStepButton
        testId="debug-step-in"
        title={t('stepInto')}
        disabled={loading || !paused}
        onClick={() => void control('stepIn')}
      >
        <ArrowDownToLine className="size-3.5" />
      </DebugStepButton>
      <DebugStepButton
        testId="debug-step-out"
        title={t('stepOut')}
        disabled={loading || !paused}
        onClick={() => void control('stepOut')}
      >
        <ArrowUpFromLine className="size-3.5" />
      </DebugStepButton>
      <DebugStepButton
        testId="restart-debug"
        title={t('restartDebug')}
        disabled={
          loading || selected === undefined || !['running', 'paused'].includes(selected.status)
        }
        onClick={() => void restart(selected?.id)}
      >
        <RotateCw className="size-3.5" />
      </DebugStepButton>
      <DebugStepButton
        testId="stop-debug"
        title={t('stopDebug')}
        disabled={active === undefined || active.status === 'stopping'}
        onClick={() => void stop(active?.id)}
      >
        <CircleStop className="size-3.5" />
      </DebugStepButton>
      <DebugStepButton
        testId="focus-debug-location"
        title={t('returnToPause')}
        disabled={active?.pause?.relativePath === undefined || active.pause.line === undefined}
        onClick={() => {
          const location = active?.pause;
          if (location?.relativePath !== undefined && location.line !== undefined) {
            void openFileAt(workspaceId, location.relativePath, location.line, location.column);
          }
        }}
      >
        <Crosshair className="size-3.5" />
      </DebugStepButton>
      <button
        type="button"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        onClick={onShowDebug}
        title={t('openDebugPanel')}
        aria-label={t('openDebugPanel')}
      >
        <CornerDownLeft className="size-3.5" />
      </button>
    </div>
  );
}

function DebugStepButton({
  children,
  disabled,
  onClick,
  title,
  testId,
}: {
  readonly children: React.ReactNode;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly title: string;
  readonly testId?: string;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}
