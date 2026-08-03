import type { StoreApi } from 'zustand';

import { rendererError } from '../settings/error-i18n';
import { mergeRunExecution, readableRunError } from './run-store-helpers';
import type { RunState } from './run.store';

type SetRunState = StoreApi<RunState>['setState'];
type GetRunState = StoreApi<RunState>['getState'];
type CompoundActions = Pick<
  RunState,
  | 'openCompoundDialog'
  | 'closeCompoundDialog'
  | 'saveCompoundConfiguration'
  | 'deleteCompoundConfiguration'
  | 'proposeCompoundStart'
  | 'decideCompound'
  | 'stopCompound'
>;

export function createRunCompoundActions(set: SetRunState, get: GetRunState): CompoundActions {
  return {
    openCompoundDialog() {
      set({ compoundDialogOpen: true, errorMessage: undefined });
    },

    closeCompoundDialog() {
      set({ compoundDialogOpen: false });
    },

    async saveCompoundConfiguration(input) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) throw new Error(rendererError('workspaceNotOpen'));
      set({ loading: true, errorMessage: undefined });
      try {
        const saved = await window.openCodeDesk.run.saveCompound({
          ...input,
          workspaceId,
          configurationIds: [...input.configurationIds],
        });
        set((state) => ({
          compoundConfigurations: [
            saved,
            ...state.compoundConfigurations.filter(
              (configuration) => configuration.id !== saved.id,
            ),
          ],
          loading: false,
        }));
        return saved;
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },

    async deleteCompoundConfiguration(compoundConfigurationId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        await window.openCodeDesk.run.deleteCompound({ workspaceId, compoundConfigurationId });
        set((state) => ({
          compoundConfigurations: state.compoundConfigurations.filter(
            (configuration) => configuration.id !== compoundConfigurationId,
          ),
          loading: false,
        }));
      } catch (error) {
        const message = readableRunError(error);
        set({ loading: false, errorMessage: message });
        throw new Error(message);
      }
    },

    async proposeCompoundStart(compoundConfigurationId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        const proposal = await window.openCodeDesk.run.proposeCompoundStart({
          workspaceId,
          compoundConfigurationId,
        });
        set((state) => ({
          executions: proposal.executions.reduce(
            (current, execution) => mergeRunExecution(current, execution),
            state.executions,
          ),
          selectedExecutionId: proposal.executions[0]?.id,
          compoundSessions: [
            proposal.session,
            ...state.compoundSessions.filter((session) => session.id !== proposal.session.id),
          ],
          pendingCompoundProposal: proposal,
          loading: false,
          compoundDialogOpen: false,
        }));
      } catch (error) {
        set({ loading: false, errorMessage: readableRunError(error) });
      }
    },

    async decideCompound(decision) {
      const proposal = get().pendingCompoundProposal;
      if (proposal === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        const updated = await Promise.all(
          proposal.executions.map((execution) =>
            window.openCodeDesk.run.decideStart({
              executionId: execution.id,
              expectedApprovalDigest: execution.approvalDigest,
              decision,
            }),
          ),
        );
        set((state) => ({
          executions: updated.reduce(
            (current, execution) => mergeRunExecution(current, execution),
            state.executions,
          ),
          pendingCompoundProposal: undefined,
          loading: false,
        }));
      } catch (error) {
        set({ loading: false, errorMessage: readableRunError(error) });
      }
    },

    async stopCompound(sessionId) {
      const workspaceId = get().workspaceId;
      if (workspaceId === undefined) return;
      set({ loading: true, errorMessage: undefined });
      try {
        await window.openCodeDesk.run.stopCompound({ workspaceId, sessionId });
        set({ loading: false });
      } catch (error) {
        set({ loading: false, errorMessage: readableRunError(error) });
      }
    },
  };
}
