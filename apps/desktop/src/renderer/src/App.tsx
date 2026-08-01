import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';

import { WelcomePage } from '@/pages/welcome-page';
import { WorkspacePage } from '@/pages/workspace-page';
import { ProviderSettingsDialog } from '@/features/providers/provider-settings-dialog';
import { useProviderStore } from '@/features/providers/provider.store';
import { AppSettingsDialog } from '@/features/settings/app-settings-dialog';
import { applyDocumentTheme, useAppSettingsStore } from '@/features/settings/app-settings.store';
import { useApplicationShortcuts } from '@/features/settings/use-application-shortcuts';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

export function App() {
  const { current, initialize, initialized } = useWorkspaceStore();
  const initializeProviders = useProviderStore((state) => state.initialize);
  const openProviderSettings = useProviderStore((state) => state.openSettings);
  const initializeAppSettings = useAppSettingsStore((state) => state.initialize);
  const appSettingsInitialized = useAppSettingsStore((state) => state.initialized);
  const openAppSettings = useAppSettingsStore((state) => state.openDialog);
  const settings = useAppSettingsStore((state) => state.settings);

  useEffect(() => {
    void initialize();
    void initializeProviders();
    void initializeAppSettings();
  }, [initialize, initializeAppSettings, initializeProviders]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applySystemTheme = () => applyDocumentTheme(settings.theme);
    applySystemTheme();
    media.addEventListener('change', applySystemTheme);
    return () => media.removeEventListener('change', applySystemTheme);
  }, [settings.theme]);

  useApplicationShortcuts(settings.shortcuts, {
    openApplicationSettings: openAppSettings,
    openProviderSettings,
  });

  if (!initialized || !appSettingsInitialized) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-500">
        <LoaderCircle className="size-6 animate-spin" aria-label="正在初始化 / Initializing" />
      </main>
    );
  }

  return (
    <>
      {current === null ? <WelcomePage /> : <WorkspacePage />}
      <ProviderSettingsDialog />
      <AppSettingsDialog />
    </>
  );
}
