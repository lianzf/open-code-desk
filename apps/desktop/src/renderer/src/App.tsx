import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';

import { WelcomePage } from '@/pages/welcome-page';
import { WorkspacePage } from '@/pages/workspace-page';
import { ProviderSettingsDialog } from '@/features/providers/provider-settings-dialog';
import { useProviderStore } from '@/features/providers/provider.store';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

export function App() {
  const { current, initialize, initialized } = useWorkspaceStore();
  const initializeProviders = useProviderStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
    void initializeProviders();
  }, [initialize, initializeProviders]);

  if (!initialized) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-500">
        <LoaderCircle className="size-6 animate-spin" aria-label="正在初始化" />
      </main>
    );
  }

  return (
    <>
      {current === null ? <WelcomePage /> : <WorkspacePage />}
      <ProviderSettingsDialog />
    </>
  );
}
