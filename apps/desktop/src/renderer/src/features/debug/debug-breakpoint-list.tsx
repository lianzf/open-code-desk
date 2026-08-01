import { Pencil, Trash2 } from 'lucide-react';

import { useEditorStore } from '@/features/editor/editor.store';
import { debugBreakpointKind } from './debug-breakpoint-format';
import { DebugSection } from './debug-panel.components';
import { useDebugStore } from './debug.store';

const pauseModeLabels = {
  none: '不因异常暂停',
  uncaught: '仅未捕获异常',
  all: '全部异常',
} as const;

export function DebugBreakpointList({ workspaceId }: { readonly workspaceId: string }) {
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const exceptionPauseMode = useDebugStore(
    (state) => state.settings?.exceptionPauseMode ?? 'uncaught',
  );
  const setExceptionPauseMode = useDebugStore((state) => state.setExceptionPauseMode);
  const deleteAllBreakpoints = useDebugStore((state) => state.deleteAllBreakpoints);
  const setBreakpointEnabled = useDebugStore((state) => state.setBreakpointEnabled);
  const openBreakpointEditor = useDebugStore((state) => state.openBreakpointEditor);
  const deleteBreakpoint = useDebugStore((state) => state.deleteBreakpoint);
  const openFileAt = useEditorStore((editor) => editor.openFileAt);

  return (
    <DebugSection title="断点">
      <label className="block border-b border-zinc-900 px-2 py-1.5 text-[9px] text-zinc-600">
        异常暂停
        <select
          className="mt-1 h-7 w-full rounded border border-zinc-800 bg-black px-2 text-[10px] text-zinc-300 outline-none focus:border-cyan-600"
          value={exceptionPauseMode}
          onChange={(event) =>
            void setExceptionPauseMode(event.target.value as 'none' | 'uncaught' | 'all')
          }
          data-testid="debug-exception-pause-mode"
          aria-label="异常暂停策略"
        >
          {Object.entries(pauseModeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {breakpoints.length === 0 ? (
        <p className="px-3 py-2 text-[10px] text-zinc-700">点击编辑器行号槽或按 F9 添加断点</p>
      ) : (
        <div className="flex justify-end border-b border-zinc-900 px-2 py-1">
          <button
            type="button"
            className="text-[9px] text-zinc-600 hover:text-red-300"
            onClick={() => void deleteAllBreakpoints()}
          >
            清空项目断点
          </button>
        </div>
      )}
      {breakpoints.map((breakpoint) => {
        const kind = debugBreakpointKind(breakpoint);
        const detail = breakpoint.logMessage ?? breakpoint.condition ?? breakpoint.hitCondition;
        return (
          <div
            key={breakpoint.id}
            className="group flex w-full items-start gap-1 px-2 py-1 text-[10px] hover:bg-zinc-900"
            data-testid="debug-breakpoint-item"
            data-breakpoint-kind={kind}
          >
            <button
              type="button"
              className={`mt-1 size-2.5 shrink-0 border ${kind === 'logpoint' ? 'rotate-45 border-cyan-500 bg-cyan-500' : kind === 'conditional' ? 'rounded-full border-amber-500 bg-amber-500' : 'rounded-full border-red-500 bg-red-500'} ${breakpoint.enabled ? '' : 'opacity-30'} ${breakpoint.status === 'verified' ? '' : 'bg-transparent'}`}
              onClick={() => void setBreakpointEnabled(breakpoint.id, !breakpoint.enabled)}
              title={`${breakpoint.enabled ? '禁用' : '启用'}断点；当前状态：${breakpoint.status}`}
              aria-label={`${breakpoint.enabled ? '禁用' : '启用'} ${breakpoint.relativePath}:${breakpoint.line}`}
            />
            <button
              type="button"
              className="min-w-0 flex-1 py-0.5 text-left text-zinc-500"
              onClick={() =>
                void openFileAt(
                  workspaceId,
                  breakpoint.relativePath,
                  breakpoint.line,
                  breakpoint.column,
                )
              }
              title={`${breakpoint.relativePath}:${breakpoint.line} · ${breakpoint.status}`}
              data-breakpoint-status={breakpoint.status}
            >
              <span className="block truncate">
                {breakpoint.relativePath}:{breakpoint.line}
              </span>
              {detail === undefined ? null : (
                <span className="block truncate text-[9px] text-zinc-700">{detail}</span>
              )}
            </button>
            <button
              type="button"
              className="mt-0.5 shrink-0 p-0.5 text-zinc-700 opacity-0 hover:text-cyan-300 group-hover:opacity-100 focus:opacity-100"
              onClick={() =>
                openBreakpointEditor(breakpoint.relativePath, breakpoint.line, breakpoint.column)
              }
              aria-label={`编辑 ${breakpoint.relativePath}:${breakpoint.line}`}
              data-testid="edit-debug-breakpoint"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              className="mt-0.5 shrink-0 p-0.5 text-zinc-700 opacity-0 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
              onClick={() => void deleteBreakpoint(breakpoint.id)}
              aria-label={`删除 ${breakpoint.relativePath}:${breakpoint.line}`}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
    </DebugSection>
  );
}
