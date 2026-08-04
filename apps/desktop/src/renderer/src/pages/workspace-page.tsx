import {
  ChevronRight,
  Bug,
  GitBranch,
  Settings2,
  ShieldCheck,
  MonitorCog,
  ListChecks,
  Play,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AuditPanel } from '@/features/audit/audit-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import { ChangeReviewDialog } from '@/features/changes/change-review-panel';
import { DebugPanel } from '@/features/debug/debug-panel';
import { DebugBreakpointDialog } from '@/features/debug/debug-breakpoint-dialog';
import { DebugToolbar } from '@/features/debug/debug-toolbar';
import { useDebugStore } from '@/features/debug/debug.store';
import { EditorWorkbench } from '@/features/editor/editor-workbench';
import { useEditorStore } from '@/features/editor/editor.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { ProjectTasksPanel } from '@/features/project-tasks/project-tasks-panel';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { useApplicationShortcuts } from '@/features/settings/use-application-shortcuts';
import { GitPanel } from '@/features/git/git-panel';
import { RunOutputPanel } from '@/features/run/run-output-panel';
import { RunToolbar } from '@/features/run/run-toolbar';
import { TerminalPanel } from '@/features/terminal/terminal-panel';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';
import { BottomPanelResizer, ChatPanelResizer } from './workspace-layout';
import { useWorkspaceLayout } from './workspace-layout-state';
import { WorkspaceSidebar } from './workspace-sidebar';

export function WorkspacePage() {
  const { current, errorMessage } = useWorkspaceStore();
  const editor = useEditorStore();
  const openEditorFileAt = useEditorStore((state) => state.openFileAt);
  const resetEditor = useEditorStore((state) => state.reset);
  const handleEditorFileChange = useEditorStore((state) => state.handleFileChange);
  const activeEditorPath = useEditorStore((state) => state.activePath);
  const handleWorkspaceFileChange = useWorkspaceStore((state) => state.handleFileChange);
  const [bottomPanel, setBottomPanel] = useState<
    'terminal' | 'git' | 'audit' | 'run' | 'debug' | 'tasks' | null
  >(null);
  const {
    bottomPanelHeight,
    setBottomPanelHeight,
    sidebarWidth,
    setSidebarWidth,
    chatWidth,
    setChatWidth,
  } = useWorkspaceLayout();
  const pausedSession = useDebugStore((state) =>
    state.sessions.find((session) => session.status === 'paused'),
  );
  const provider = useProviderStore();
  const openAppSettings = useAppSettingsStore((state) => state.openDialog);
  const settings = useAppSettingsStore((state) => state.settings);
  const t = (key: Parameters<typeof translate>[1]) => translate(settings.locale, key);
  const selectedProvider = provider.configurations.find(
    (configuration) => configuration.id === provider.selectedProviderId,
  );
  const workspaceShortcutHandlers = useMemo(
    () => ({
      toggleTerminal: () => setBottomPanel((value) => (value === 'terminal' ? null : 'terminal')),
      toggleGit: () => setBottomPanel((value) => (value === 'git' ? null : 'git')),
    }),
    [],
  );
  useApplicationShortcuts(settings.shortcuts, workspaceShortcutHandlers);

  useEffect(() => {
    if (current !== null) {
      resetEditor(current.id);
    }
  }, [current, resetEditor]);

  useEffect(() => {
    return window.openCodeDesk.files.onChanged((event) => {
      void handleWorkspaceFileChange(event.workspaceId, event.relativePath);
      void handleEditorFileChange(event.workspaceId, event.relativePath);
    });
  }, [handleEditorFileChange, handleWorkspaceFileChange]);

  useEffect(() => {
    if (current === null || activeEditorPath === null) {
      return;
    }

    let reconciling = false;
    const reconcile = async () => {
      if (reconciling) return;
      reconciling = true;
      try {
        await handleEditorFileChange(current.id, activeEditorPath);
      } finally {
        reconciling = false;
      }
    };
    const interval = window.setInterval(() => void reconcile(), 1_000);
    void reconcile();
    return () => window.clearInterval(interval);
  }, [activeEditorPath, current, handleEditorFileChange]);

  useEffect(() => {
    const relativePath = pausedSession?.pause?.relativePath;
    const line = pausedSession?.pause?.line;
    if (current !== null && relativePath !== undefined && line !== undefined) {
      void openEditorFileAt(current.id, relativePath, line, pausedSession?.pause?.column);
      const frame = window.requestAnimationFrame(() => setBottomPanel('debug'));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [
    current,
    openEditorFileAt,
    pausedSession?.pause?.column,
    pausedSession?.pause?.line,
    pausedSession?.pause?.relativePath,
  ]);

  if (current === null) {
    return null;
  }

  return (
    <main
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      data-testid="workspace-page"
    >
      <header className="flex shrink-0 flex-col border-b border-zinc-800 2xl:h-12 2xl:flex-row 2xl:items-center">
        <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 px-3 text-sm 2xl:h-auto 2xl:flex-1">
          <div className="grid size-7 place-items-center rounded-lg bg-cyan-400 text-zinc-950">
            <ChevronRight className="size-4" aria-hidden="true" />
          </div>
          <span className="truncate font-semibold" data-testid="workspace-name">
            {current.name}
          </span>
          <span className="hidden truncate text-xs text-zinc-600 xl:inline">
            {current.rootPath}
          </span>
        </div>
        <div className="flex h-12 w-full shrink-0 items-center gap-2 overflow-x-auto border-t border-zinc-800 px-3 [&>*]:shrink-0 2xl:ml-auto 2xl:h-auto 2xl:w-auto 2xl:border-t-0 2xl:pl-0">
          <RunToolbar workspaceId={current.id} onShowOutput={() => setBottomPanel('run')} />
          <DebugToolbar workspaceId={current.id} onShowDebug={() => setBottomPanel('debug')} />
          <button
            className="rounded border border-zinc-800 p-1.5 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
            onClick={openAppSettings}
            aria-label={t('appSettings')}
            title={`${t('appSettings')} (${settings.shortcuts.openApplicationSettings})`}
            data-testid="open-app-settings"
          >
            <MonitorCog className="size-3" />
          </button>
          <button
            className="flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            onClick={provider.openSettings}
            title={`${t('configureModel')} (${settings.shortcuts.openProviderSettings})`}
          >
            <Settings2 className="size-3" />
            {selectedProvider === undefined
              ? t('configureModel')
              : `${selectedProvider.displayName} · ${
                  provider.selectedModels[selectedProvider.id] ?? selectedProvider.defaultModel
                }`}
          </button>
          <Button size="sm" disabled>
            {t('startAgent')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          workspaceId={current.id}
          width={sidebarWidth}
          setWidth={setSidebarWidth}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <EditorWorkbench />
            <div
              className="relative h-full shrink-0"
              style={{ width: chatWidth }}
              data-testid="chat-panel-container"
            >
              <ChatPanelResizer
                label={t('resizeChatPanel')}
                value={chatWidth}
                setValue={setChatWidth}
              />
              <ChatPanel />
            </div>
          </div>

          {bottomPanel === null ? null : (
            <div
              className="relative min-h-0 shrink-0"
              style={{ height: bottomPanelHeight }}
              data-testid="bottom-panel-container"
            >
              <BottomPanelResizer
                label={t('resizeBottomPanel')}
                value={bottomPanelHeight}
                setValue={setBottomPanelHeight}
              />
              {bottomPanel === 'terminal' ? (
                <TerminalPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
              ) : null}
              {bottomPanel === 'git' ? (
                <GitPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
              ) : null}
              {bottomPanel === 'audit' ? (
                <AuditPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
              ) : null}
              {bottomPanel === 'run' ? (
                <RunOutputPanel onClose={() => setBottomPanel(null)} />
              ) : null}
              {bottomPanel === 'debug' ? (
                <DebugPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
              ) : null}
              {bottomPanel === 'tasks' ? (
                <ProjectTasksPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
              ) : null}
            </div>
          )}

          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-500">
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'debug' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'debug' ? null : 'debug'))}
              data-testid="toggle-debug"
            >
              <Bug className="size-3" />
              {t('debug')}
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'run' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'run' ? null : 'run'))}
              data-testid="toggle-run-output"
            >
              <Play className="size-3" />
              {t('run')}
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'tasks' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'tasks' ? null : 'tasks'))}
              data-testid="toggle-project-tasks"
            >
              <ListChecks className="size-3" />
              {t('tasks')}
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'git' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'git' ? null : 'git'))}
              title={settings.shortcuts.toggleGit}
              data-testid="toggle-git"
            >
              <GitBranch className="size-3" />
              Git
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'terminal' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'terminal' ? null : 'terminal'))}
              title={settings.shortcuts.toggleTerminal}
              data-testid="toggle-terminal"
            >
              <TerminalSquare className="size-3" />
              {t('terminal')}
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'audit' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'audit' ? null : 'audit'))}
              data-testid="toggle-audit"
            >
              <ShieldCheck className="size-3" />
              {t('audit')}
            </button>
            <span className="ml-auto">{editor.activePath ?? t('noOpenFile')}</span>
          </div>
        </section>
      </div>

      {errorMessage !== undefined || editor.errorMessage !== undefined ? (
        <div
          className="absolute bottom-10 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-red-900/70 bg-red-950 px-4 py-2 text-xs text-red-200 shadow-xl"
          role="alert"
        >
          {errorMessage ?? editor.errorMessage}
        </div>
      ) : null}
      <ChangeReviewDialog />
      <DebugBreakpointDialog />
    </main>
  );
}
