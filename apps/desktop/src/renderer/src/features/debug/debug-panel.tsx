import { Check, Copy, Plus, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/features/editor/editor.store';
import { DebugAiAction } from './debug-ai-action';
import { DebugBreakpointList } from './debug-breakpoint-list';
import { DebugSection, VariableList } from './debug-panel.components';
import { useDebugStore } from './debug.store';

const statusLabels = {
  pending_approval: '等待批准',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停',
  stopping: '停止中',
  stopped: '已停止',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
} as const;

export function DebugPanel({
  workspaceId,
  onClose,
}: {
  readonly workspaceId: string;
  readonly onClose: () => void;
}) {
  const state = useDebugStore();
  const openFileAt = useEditorStore((editor) => editor.openFileAt);
  const [watchDraft, setWatchDraft] = useState('');
  const [expression, setExpression] = useState('');
  const [consoleSearch, setConsoleSearch] = useState('');
  const session = state.sessions.find((item) => item.id === state.selectedSessionId);
  const visibleConsoleEntries = state.consoleEntries.filter(
    (entry) =>
      entry.category !== 'telemetry' &&
      (consoleSearch === '' ||
        entry.data.toLocaleLowerCase().includes(consoleSearch.toLocaleLowerCase())),
  );
  const visibleError = state.errorMessage ?? session?.error?.message;

  return (
    <section
      className="flex h-72 min-h-0 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950"
      data-testid="debug-panel"
    >
      <header className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3">
        <span className="text-xs font-semibold text-zinc-200">调试</span>
        <span
          className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500"
          data-testid="debug-status"
        >
          {session === undefined ? '未启动' : statusLabels[session.status]}
        </span>
        {session?.pause === undefined ? null : (
          <span
            className="truncate text-[10px] text-amber-300"
            title={session.pause.exception?.stackTrace}
          >
            {session.pause.exception?.typeName ??
              session.pause.exception?.exceptionId ??
              session.pause.reason}
            {session.pause.exception?.message === undefined
              ? ''
              : `：${session.pause.exception.message}`}
            {' · '}
            {session.pause.relativePath ?? '未知位置'}:{session.pause.line ?? '—'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DebugAiAction paused={session?.status === 'paused'} />
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800"
            onClick={onClose}
            aria-label="关闭调试面板"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {session?.status === 'pending_approval' ? (
        <div className="flex items-center gap-3 border-b border-cyan-900/50 bg-cyan-950/20 px-3 py-2 text-[11px]">
          <div className="min-w-0 flex-1">
            <p className="text-zinc-300">
              调试将执行：
              {[
                session.command.executable,
                ...session.command.runtimeArgs,
                ...session.command.args,
              ].join(' ')}
            </p>
            <p className="truncate text-zinc-500">
              批准仅对当前命令摘要生效 · {session.riskReasons.join(' ')}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void state.decideStart(session.id, 'reject')}
            data-testid="reject-debug"
          >
            拒绝
          </Button>
          <Button
            size="sm"
            disabled={session.riskLevel === 'blocked'}
            onClick={() => void state.decideStart(session.id, 'approve')}
            data-testid="approve-debug"
          >
            <Check className="size-3.5" />
            批准调试
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_320px_1fr]">
        <div className="min-h-0 overflow-auto border-r border-zinc-800">
          <DebugSection title="线程">
            {state.threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`block w-full truncate px-3 py-1 text-left text-[11px] ${thread.id === state.selectedThreadId ? 'bg-cyan-950/40 text-cyan-300' : 'text-zinc-400 hover:bg-zinc-900'}`}
                onClick={() => void state.selectThread(thread.id)}
              >
                {thread.name} #{thread.id}
              </button>
            ))}
          </DebugSection>
          <DebugSection title="调用栈">
            {state.stackFrames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                className={`block w-full px-3 py-1.5 text-left ${frame.id === state.selectedFrameId ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
                onClick={() => {
                  void state.selectFrame(frame.id);
                  if (frame.relativePath !== undefined) {
                    void openFileAt(workspaceId, frame.relativePath, frame.line, frame.column);
                  }
                }}
              >
                <span className="block truncate text-[11px] text-zinc-300">{frame.name}</span>
                <span className="block truncate text-[9px] text-zinc-600">
                  {frame.relativePath ?? frame.sourceName ?? '内部代码'}:{frame.line}
                </span>
              </button>
            ))}
          </DebugSection>
          <DebugBreakpointList workspaceId={workspaceId} />
        </div>

        <div className="min-h-0 overflow-auto border-r border-zinc-800">
          <DebugSection title="变量">
            {state.scopes.map((scope) => (
              <div key={scope.variablesReference} className="border-b border-zinc-900 pb-1">
                <p className="px-3 py-1 text-[10px] font-medium text-zinc-500">{scope.name}</p>
                <VariableList
                  variables={state.variables[scope.variablesReference] ?? []}
                  values={state.variables}
                  expand={state.expandVariables}
                  depth={0}
                />
              </div>
            ))}
          </DebugSection>
          <DebugSection title="监视">
            <form
              className="flex gap-1 px-2 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                void state.addWatch(watchDraft).then(() => setWatchDraft(''));
              }}
            >
              <input
                className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-black px-2 text-[11px] outline-none focus:border-cyan-600"
                value={watchDraft}
                onChange={(event) => setWatchDraft(event.target.value)}
                placeholder="添加表达式"
                data-testid="debug-watch-input"
              />
              <Button size="icon" variant="ghost" type="submit" disabled={watchDraft.trim() === ''}>
                <Plus className="size-3.5" />
              </Button>
            </form>
            {state.watches.map((watch) => {
              const result = state.watchResults[watch.id];
              return (
                <div key={watch.id} className="group flex items-start gap-2 px-3 py-1 text-[10px]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-300">{watch.expression}</p>
                    <p className="truncate text-zinc-600">
                      {typeof result === 'string' ? result : (result?.result ?? '未求值')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => void state.deleteWatch(watch.id)}
                    aria-label={`删除监视 ${watch.expression}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              );
            })}
          </DebugSection>
        </div>

        <div className="flex min-h-0 flex-col bg-black">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
            <span className="mr-auto text-[10px] font-medium text-zinc-500">调试控制台</span>
            <label className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 text-zinc-600 focus-within:border-zinc-600">
              <Search className="size-3" />
              <input
                className="h-5 w-28 bg-transparent text-[9px] text-zinc-300 outline-none"
                value={consoleSearch}
                onChange={(event) => setConsoleSearch(event.target.value)}
                placeholder="搜索输出"
                aria-label="搜索调试输出"
              />
            </label>
            <button
              type="button"
              className="rounded p-1 text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
              onClick={() =>
                void navigator.clipboard.writeText(
                  visibleConsoleEntries.map((entry) => entry.data).join(''),
                )
              }
              title="复制当前结果"
              aria-label="复制调试输出"
            >
              <Copy className="size-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-zinc-600 hover:bg-zinc-900 hover:text-red-300"
              onClick={state.clearConsole}
              title="清空控制台"
              aria-label="清空调试控制台"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5">
            {visibleConsoleEntries.map((entry) => (
              <div
                key={entry.id}
                className={
                  entry.category === 'stderr'
                    ? 'whitespace-pre-wrap text-red-300'
                    : entry.category === 'input'
                      ? 'text-cyan-300'
                      : 'whitespace-pre-wrap text-zinc-400'
                }
              >
                {entry.data}
              </div>
            ))}
          </div>
          <form
            className="flex border-t border-zinc-800 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void state.evaluate(expression).then(() => setExpression(''));
            }}
          >
            <span className="px-2 py-1 text-cyan-500">›</span>
            <input
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-200 outline-none"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              disabled={session?.status !== 'paused'}
              placeholder={session?.status === 'paused' ? '在当前栈帧求值' : '暂停后可求值'}
              data-testid="debug-console-input"
            />
          </form>
        </div>
      </div>
      {visibleError === undefined ? null : (
        <p
          className="border-t border-red-900/60 px-3 py-1 text-[10px] text-red-300"
          role="alert"
          data-testid="debug-error"
        >
          {session?.error === undefined ? '' : `${session.error.code}：`}
          {visibleError}
          {session?.error?.retryable === true ? ' 可检查配置后重试。' : ''}
        </p>
      )}
    </section>
  );
}
