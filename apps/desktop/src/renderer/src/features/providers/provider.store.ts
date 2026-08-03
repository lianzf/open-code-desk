import { create } from 'zustand';
import type {
  ConnectionTestResult,
  ModelInfo,
  ProviderConfig,
  ProviderDescriptor,
  SaveProviderRequest,
} from '@open-code-desk/ipc-contracts';

import { rendererErrorMessage } from '../settings/error-i18n';

interface ProviderState {
  readonly configurations: ReadonlyArray<ProviderConfig>;
  readonly descriptors: ReadonlyArray<ProviderDescriptor>;
  readonly errorMessage: string | undefined;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly models: Readonly<Record<string, ReadonlyArray<ModelInfo>>>;
  readonly selectedModels: Readonly<Record<string, string>>;
  readonly selectedProviderId: string | undefined;
  readonly settingsOpen: boolean;
  readonly testResult: ConnectionTestResult | undefined;
  closeSettings(): void;
  delete(providerId: string): Promise<void>;
  initialize(): Promise<void>;
  listModels(providerId: string): Promise<ReadonlyArray<ModelInfo>>;
  openSettings(): void;
  persistSelection(): Promise<void>;
  save(input: SaveProviderRequest): Promise<ProviderConfig>;
  selectModel(providerId: string, model: string): void;
  selectProvider(providerId: string): void;
  testConnection(providerId: string): Promise<ConnectionTestResult>;
}

function errorMessage(error: unknown): string {
  return rendererErrorMessage(error, 'providerOperationFailed');
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  configurations: [],
  descriptors: [],
  errorMessage: undefined,
  initialized: false,
  loading: false,
  models: {},
  selectedModels: {},
  selectedProviderId: undefined,
  settingsOpen: false,
  testResult: undefined,

  openSettings() {
    set({ settingsOpen: true, errorMessage: undefined, testResult: undefined });
  },

  closeSettings() {
    set({ settingsOpen: false, errorMessage: undefined, testResult: undefined });
  },

  async initialize() {
    if (get().initialized) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const [configurations, descriptors, settings] = await Promise.all([
        window.openCodeDesk.providers.list(),
        window.openCodeDesk.providers.listKinds(),
        window.openCodeDesk.settings.get(),
      ]);
      const providerIds = new Set(configurations.map((configuration) => configuration.id));
      const selectedProviderId =
        settings.selectedProviderId !== undefined && providerIds.has(settings.selectedProviderId)
          ? settings.selectedProviderId
          : configurations[0]?.id;
      const selectedModels = Object.fromEntries(
        configurations.map((configuration) => [
          configuration.id,
          settings.selectedModels[configuration.id] ?? configuration.defaultModel,
        ]),
      );
      set({
        configurations,
        descriptors,
        initialized: true,
        loading: false,
        ...(selectedProviderId === undefined ? {} : { selectedProviderId }),
        selectedModels,
      });
      await get().persistSelection();
    } catch (error) {
      set({
        initialized: true,
        loading: false,
        errorMessage: errorMessage(error),
      });
    }
  },

  async save(input) {
    set({ loading: true, errorMessage: undefined, testResult: undefined });
    try {
      const saved = await window.openCodeDesk.providers.save(input);
      const configurations = [
        saved,
        ...get().configurations.filter((configuration) => configuration.id !== saved.id),
      ];
      set((state) => ({
        configurations,
        loading: false,
        selectedProviderId: saved.id,
        selectedModels: {
          ...state.selectedModels,
          [saved.id]: saved.defaultModel,
        },
      }));
      await get().persistSelection();
      return saved;
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async delete(providerId) {
    set({ loading: true, errorMessage: undefined, testResult: undefined });
    try {
      await window.openCodeDesk.providers.delete({ providerId });
      const configurations = get().configurations.filter(
        (configuration) => configuration.id !== providerId,
      );
      set((state) => {
        const selectedModels = { ...state.selectedModels };
        delete selectedModels[providerId];
        return {
          configurations,
          loading: false,
          selectedModels,
          selectedProviderId:
            state.selectedProviderId === providerId
              ? configurations[0]?.id
              : state.selectedProviderId,
        };
      });
      await get().persistSelection();
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async testConnection(providerId) {
    set({ loading: true, errorMessage: undefined, testResult: undefined });
    try {
      const result = await window.openCodeDesk.providers.testConnection({ providerId });
      set({ loading: false, testResult: result });
      return result;
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async listModels(providerId) {
    set({ loading: true, errorMessage: undefined });
    try {
      const models = await window.openCodeDesk.providers.listModels({ providerId });
      set((state) => ({
        loading: false,
        models: { ...state.models, [providerId]: models },
      }));
      return models;
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async persistSelection() {
    const { selectedModels, selectedProviderId } = get();
    try {
      await window.openCodeDesk.settings.update({
        ...(selectedProviderId === undefined ? {} : { selectedProviderId }),
        selectedModels,
      });
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
    }
  },

  selectProvider(providerId) {
    const configuration = get().configurations.find((item) => item.id === providerId);
    if (configuration === undefined) {
      return;
    }
    set((state) => ({
      selectedProviderId: providerId,
      selectedModels: {
        ...state.selectedModels,
        [providerId]: state.selectedModels[providerId] ?? configuration.defaultModel,
      },
    }));
    void get().persistSelection();
  },

  selectModel(providerId, model) {
    set((state) => ({
      selectedModels: { ...state.selectedModels, [providerId]: model },
    }));
    void get().persistSelection();
  },
}));
