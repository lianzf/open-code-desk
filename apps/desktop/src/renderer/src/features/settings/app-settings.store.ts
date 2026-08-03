import {
  appSettingsSchema,
  type AppSettings,
  type UpdateAppSettingsRequest,
} from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import { rendererErrorMessage } from './error-i18n';

interface AppSettingsState {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly open: boolean;
  readonly errorMessage: string | undefined;
  readonly settings: AppSettings;
  close(): void;
  initialize(): Promise<void>;
  openDialog(): void;
  update(input: UpdateAppSettingsRequest): Promise<AppSettings>;
}

const initialSettings = appSettingsSchema.parse({ selectedModels: {} });

function describeError(error: unknown): string {
  return rendererErrorMessage(error, 'settingsOperationFailed');
}

export function applyDocumentTheme(theme: AppSettings['theme']): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function applyDocumentLocale(locale: AppSettings['locale']): void {
  document.documentElement.lang = locale;
}

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  initialized: false,
  loading: false,
  open: false,
  errorMessage: undefined,
  settings: initialSettings,

  openDialog() {
    set({ open: true, errorMessage: undefined });
  },

  close() {
    set({ open: false, errorMessage: undefined });
  },

  async initialize() {
    if (get().initialized || get().loading) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const settings = await window.openCodeDesk.settings.get();
      applyDocumentTheme(settings.theme);
      applyDocumentLocale(settings.locale);
      set({ initialized: true, loading: false, settings });
    } catch (error) {
      applyDocumentTheme(initialSettings.theme);
      applyDocumentLocale(initialSettings.locale);
      set({
        initialized: true,
        loading: false,
        errorMessage: describeError(error),
      });
    }
  },

  async update(input) {
    set({ loading: true, errorMessage: undefined });
    try {
      const settings = await window.openCodeDesk.settings.update(input);
      applyDocumentTheme(settings.theme);
      applyDocumentLocale(settings.locale);
      set({ loading: false, settings });
      return settings;
    } catch (error) {
      const message = describeError(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },
}));
