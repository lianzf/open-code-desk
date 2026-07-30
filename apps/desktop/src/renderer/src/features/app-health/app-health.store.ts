import type { HealthResponse } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

type HealthStatus = 'checking' | 'healthy' | 'unavailable';

interface AppHealthState {
  readonly status: HealthStatus;
  readonly response: HealthResponse | undefined;
  readonly errorMessage: string | undefined;
  check(): Promise<void>;
}

export const useAppHealthStore = create<AppHealthState>((set) => ({
  status: 'checking',
  response: undefined,
  errorMessage: undefined,
  async check() {
    set({ status: 'checking', response: undefined, errorMessage: undefined });

    try {
      const response = await window.openCodeDesk.app.health({
        requestId: crypto.randomUUID(),
      });
      set({ status: 'healthy', response, errorMessage: undefined });
    } catch {
      set({
        status: 'unavailable',
        response: undefined,
        errorMessage: '无法连接桌面端主进程，请重新启动应用。',
      });
    }
  },
}));
