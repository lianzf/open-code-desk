import { Blocks, Clock3, FolderOpen, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AppHealthCard } from '@/features/app-health/app-health-card';
import { useProviderStore } from '@/features/providers/provider.store';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

const foundations = [
  {
    icon: FolderOpen,
    title: '本地工作区',
    description: '文件能力在主进程中经过路径边界、真实路径和敏感文件校验。',
  },
  {
    icon: KeyRound,
    title: '用户自带密钥',
    description: '模型凭据由操作系统安全能力加密，数据库只保存不可读密文和引用。',
  },
  {
    icon: ShieldCheck,
    title: '审批驱动',
    description: 'AI 写入与命令执行必须先展示目标和风险。',
  },
];

export function WelcomePage() {
  const { errorMessage, loading, openDialog, openRecent, recent } = useWorkspaceStore();
  const openProviderSettings = useProviderStore((state) => state.openSettings);

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100" data-testid="app-shell">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-zinc-950">
              <Blocks className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-zinc-50">OpenCode Desk</p>
              <p className="text-xs text-zinc-500">Local-first AI coding workspace</p>
            </div>
          </div>
          <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
            阶段 4 · Model Provider
          </span>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="text-sm font-medium text-cyan-400">安全、可审阅、可扩展</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              你的代码留在本地，<span className="text-zinc-500">模型由你选择。</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
              选择一个本地代码项目，按需展开文件树并使用 Monaco
              查看与编辑文本文件。所有文件访问都通过安全 IPC 进入主进程。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                onClick={() => void openDialog()}
                disabled={loading}
                data-testid="open-project"
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <FolderOpen className="size-4" />
                )}
                打开本地项目
              </Button>
              <Button
                variant="outline"
                onClick={openProviderSettings}
                data-testid="open-provider-settings"
              >
                配置模型
              </Button>
            </div>
            {errorMessage !== undefined ? (
              <p className="mt-3 text-sm text-red-400" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
          <AppHealthCard />
        </section>

        {recent.length > 0 ? (
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Clock3 className="size-4 text-zinc-500" aria-hidden="true" />
              最近项目
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {recent.map((workspace) => (
                <button
                  key={workspace.id}
                  className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left hover:border-zinc-700 hover:bg-zinc-900"
                  onClick={() => void openRecent(workspace.id)}
                  data-testid={`recent-workspace-${workspace.id}`}
                >
                  <p className="truncate text-sm font-medium text-zinc-200">{workspace.name}</p>
                  <p className="mt-1 truncate text-xs text-zinc-600">{workspace.rootPath}</p>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          {foundations.map(({ description, icon: Icon, title }) => (
            <article key={title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <Icon className="size-5 text-cyan-400" aria-hidden="true" />
              <h2 className="mt-4 font-medium text-zinc-100">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
