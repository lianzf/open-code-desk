import { Wrench } from 'lucide-react';

import type { DisplayToolActivity } from './chat.store';

const toolStatusLabels = {
  pending: '等待',
  running: '执行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  rejected: '已拒绝',
} as const;

function serializeInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return '参数无法显示';
  }
}

export function ToolActivityItem({ activity }: { readonly activity: DisplayToolActivity }) {
  return (
    <div
      className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-1.5"
      data-testid="tool-activity"
    >
      <div className="flex items-center gap-1.5 text-[11px]">
        <Wrench className="size-3 text-amber-400" />
        <span className="font-medium text-zinc-300">{activity.name}</span>
        <span
          className={
            activity.status === 'completed'
              ? 'ml-auto text-emerald-400'
              : activity.status === 'running'
                ? 'ml-auto text-cyan-400'
                : 'ml-auto text-amber-400'
          }
        >
          {toolStatusLabels[activity.status]}
        </span>
      </div>
      {activity.input !== undefined ? (
        <details className="mt-1 text-[10px] text-zinc-500">
          <summary className="cursor-pointer">查看参数</summary>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap">
            {serializeInput(activity.input)}
          </pre>
        </details>
      ) : null}
      {activity.errorMessage !== undefined ? (
        <p className="mt-1 text-[10px] text-red-400">{activity.errorMessage}</p>
      ) : null}
    </div>
  );
}
