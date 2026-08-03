import type { RunConfigurationDraft } from '@open-code-desk/ipc-contracts';
import type { StoreApi } from 'zustand';

import { rendererError } from '../settings/error-i18n';
import { readableRunError, suggestionToSaveRequest } from './run-store-helpers';
import type { RunState } from './run.store';

type SetRunState = StoreApi<RunState>['setState'];
type GetRunState = StoreApi<RunState>['getState'];
type ConfigurationActions = Pick<
  RunState,
  | 'openConfigurationDialog'
  | 'closeConfigurationDialog'
  | 'saveConfiguration'
  | 'saveSuggestion'
  | 'deleteConfiguration'
  | 'duplicateConfiguration'
  | 'setDefaultConfiguration'
>;

export function createRunConfigurationActions(
  set: SetRunState,
  get: GetRunState,
): ConfigurationActions {
  return {
    openConfigurationDialog(configurationId) {
      set({ dialogOpen: true, editingConfigurationId: configurationId, errorMessage: undefined });
      const workspaceId = get().workspaceId;
      if (workspaceId !== undefined) {
        void window.openCodeDesk.projectTasks
          .list({ workspaceId })
          .then((projectTasks) => {
            if (get().workspaceId === workspaceId) set({ projectTasks });
          })
          .catch((error: unknown) => set({ errorMessage: readableRunError(error) }));
      }
    },

    closeConfigurationDialog() {
      set({ dialogOpen: false, editingConfigurationId: undefined });
    },

    async saveConfiguration(input) {
      set({ loading: true, errorMessage: undefined });
      try {
        const saved = await window.openCodeDesk.run.save(input);
        set((state) => ({
          configurations: [
            saved,
            ...state.configurations.filter((configuration) => configuration.id !== saved.id),
          ],
          selectedConfigurationId: saved.id,
          editingConfigurationId: saved.id,
          loading: false,
        }));
        return saved;
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },

    async saveSuggestion(suggestion: RunConfigurationDraft) {
      return get().saveConfiguration(suggestionToSaveRequest(suggestion));
    },

    async deleteConfiguration(configurationId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        await window.openCodeDesk.run.delete({ workspaceId, configurationId });
        set((state) => {
          const configurations = state.configurations.filter(
            (configuration) => configuration.id !== configurationId,
          );
          return {
            configurations,
            defaultConfigurationId:
              state.defaultConfigurationId === configurationId
                ? null
                : state.defaultConfigurationId,
            selectedConfigurationId:
              state.selectedConfigurationId === configurationId
                ? configurations[0]?.id
                : state.selectedConfigurationId,
            editingConfigurationId: undefined,
            dialogOpen: false,
            loading: false,
          };
        });
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },

    async duplicateConfiguration(configurationId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) throw new Error(rendererError('workspaceNotOpen'));
      set({ loading: true, errorMessage: undefined });
      try {
        const duplicated = await window.openCodeDesk.run.duplicate({
          workspaceId,
          configurationId,
        });
        set((state) => ({
          configurations: [duplicated, ...state.configurations],
          selectedConfigurationId: duplicated.id,
          editingConfigurationId: duplicated.id,
          loading: false,
        }));
        return duplicated;
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },

    async setDefaultConfiguration(configurationId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        const result = await window.openCodeDesk.run.setDefault({ workspaceId, configurationId });
        set({ defaultConfigurationId: result.defaultConfigurationId, loading: false });
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },
  };
}
