import type { AuditEvent } from '@open-code-desk/ipc-contracts';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface AuditPanelProps {
  readonly workspaceId: string;
  readonly onClose: () => void;
}

const outcomeLabels: Readonly<Record<AuditEvent['outcome'], string>> = {
  requested: '请求',
  allowed: '允许',
  denied: '拒绝',
  started: '开始',
  succeeded: '成功',
  failed: '失败',
  cancelled: '取消',
};

function outcomeClass(outcome: AuditEvent['outcome']): string {
  if (outcome === 'failed' || outcome === 'denied') {
    return 'text-red-400';
  }
  if (outcome === 'succeeded' || outcome === 'allowed') {
    return 'text-emerald-400';
  }
  return 'text-amber-400';
}

export function AuditPanel({ workspaceId, onClose }: AuditPanelProps) {
  const [events, setEvents] = useState<ReadonlyArray<AuditEvent>>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      setEvents(await window.openCodeDesk.audit.list({ workspaceId, limit: 200 }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '读取审计日志失败。');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    void window.openCodeDesk.audit
      .list({ workspaceId, limit: 200 })
      .then((result) => {
        if (active) {
          setEvents(result);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : '读取审计日志失败。');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  return (
    <section
      className="flex h-60 min-h-0 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950"
      data-testid="audit-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]">
        <ShieldCheck className="size-3.5 text-cyan-500" />
        <span className="font-medium text-zinc-300">审计日志</span>
        <span className="text-zinc-600">{events.length} 条近期事件</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="刷新审计日志"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            aria-label="关闭审计日志"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>
      {errorMessage === undefined ? null : (
        <p className="border-b border-red-950 bg-red-950/40 px-3 py-1 text-[11px] text-red-300">
          {errorMessage}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 && !loading ? (
          <div className="grid h-full place-items-center text-xs text-zinc-600">尚无审计事件</div>
        ) : (
          events.map((event) => (
            <article
              key={event.id}
              className="grid grid-cols-[140px_72px_100px_1fr] gap-2 border-b border-zinc-900 px-3 py-1.5 text-[10px]"
            >
              <time className="text-zinc-600">{new Date(event.createdAt).toLocaleString()}</time>
              <span className={outcomeClass(event.outcome)}>{outcomeLabels[event.outcome]}</span>
              <code className="truncate text-cyan-500">{event.action}</code>
              <span className="truncate text-zinc-400" title={event.summary}>
                {event.summary}
              </span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
