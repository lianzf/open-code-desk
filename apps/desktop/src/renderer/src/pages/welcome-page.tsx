import {
  Blocks,
  Clock3,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  MonitorCog,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AppHealthCard } from '@/features/app-health/app-health-card';
import { useProviderStore } from '@/features/providers/provider.store';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

export function WelcomePage() {
  const { errorMessage, loading, openDialog, openRecent, recent } = useWorkspaceStore();
  const openProviderSettings = useProviderStore((state) => state.openSettings);
  const openAppSettings = useAppSettingsStore((state) => state.openDialog);
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const foundations = [
    {
      icon: FolderOpen,
      title: t('localWorkspace'),
      description: t('localWorkspaceDescription'),
    },
    {
      icon: KeyRound,
      title: t('bringYourOwnKey'),
      description: t('bringYourOwnKeyDescription'),
    },
    {
      icon: ShieldCheck,
      title: t('approvalDriven'),
      description: t('approvalDrivenDescription'),
    },
  ];

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
          <button
            className="rounded-lg border border-zinc-800 p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={openAppSettings}
            aria-label={t('appSettings')}
            data-testid="open-app-settings"
          >
            <MonitorCog className="size-4" />
          </button>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="text-sm font-medium text-cyan-400">{t('welcomeEyebrow')}</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              {t('welcomeTitle')}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
              {t('welcomeDescription')}
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
                {t('openProject')}
              </Button>
              <Button
                variant="outline"
                onClick={openProviderSettings}
                data-testid="open-provider-settings"
              >
                {t('configureModel')}
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
              {t('recentProjects')}
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
