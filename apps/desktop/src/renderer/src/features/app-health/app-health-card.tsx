import { CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useAppHealthStore } from '@/features/app-health/app-health.store';

export function AppHealthCard() {
  const { check, errorMessage, response, status } = useAppHealthStore();

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
            Desktop bridge
          </p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-50">安全通信状态</h2>
        </div>
        {status === 'checking' ? (
          <LoaderCircle className="size-5 animate-spin text-zinc-400" aria-hidden="true" />
        ) : status === 'healthy' ? (
          <CheckCircle2 className="size-5 text-emerald-400" aria-hidden="true" />
        ) : (
          <ShieldAlert className="size-5 text-amber-400" aria-hidden="true" />
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-400" data-testid="health-status">
        {status === 'checking'
          ? '正在校验主进程连接…'
          : status === 'healthy'
            ? `主进程连接正常 · v${response?.version ?? 'unknown'}`
            : errorMessage}
      </p>

      {status === 'unavailable' ? (
        <Button className="mt-4" variant="outline" size="sm" onClick={() => void check()}>
          重新检测
        </Button>
      ) : null}
    </section>
  );
}
