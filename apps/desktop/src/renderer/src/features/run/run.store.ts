import type {
  ProjectDetection,
  RunApprovalDecision,
  RunConfiguration,
  RunConfigurationDraft,
  RunEvent,
  RunExecution,
  SaveRunConfigurationRequest,
} from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import {
  appendRunOutput,
  isActiveRunStatus,
  mergeRunExecution,
  readableRunError,
  suggestionToSaveRequest,
  type RunOutputChunk,
} from './run-store-helpers';

export { appendRunOutput, mergeRunExecution } from './run-store-helpers';

interface RunState {
  readonly workspaceId: string | undefined;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly configurations: ReadonlyArray<RunConfiguration>;
  readonly defaultConfigurationId: string | null;
  readonly selectedConfigurationId: string | undefined;
  readonly detection: ProjectDetection | undefined;
  readonly executions: ReadonlyArray<RunExecution>;
  readonly selectedExecutionId: string | undefined;
  readonly outputChunks: Readonly<Record<string, ReadonlyArray<RunOutputChunk>>>;
  readonly outputSequences: Readonly<Record<string, number>>;
  readonly busyExecutionId: string | undefined;
  readonly dialogOpen: boolean;
  readonly editingConfigurationId: string | undefined;
  readonly errorMessage: string | undefined;
  initialize(workspaceId: string): Promise<void>;
  dispose(): void;
  selectConfiguration(configurationId: string): void;
  selectExecution(executionId: string): void;
  openConfigurationDialog(configurationId?: string): void;
  closeConfigurationDialog(): void;
  saveConfiguration(input: SaveRunConfigurationRequest): Promise<RunConfiguration>;
  saveSuggestion(suggestion: RunConfigurationDraft): Promise<RunConfiguration>;
  deleteConfiguration(configurationId: string): Promise<void>;
  setDefaultConfiguration(configurationId: string | null): Promise<void>;
  proposeStart(configurationId?: string): Promise<RunExecution | undefined>;
  decideStart(executionId: string, decision: RunApprovalDecision): Promise<void>;
  stop(executionId?: string): Promise<void>;
  restart(executionId?: string): Promise<RunExecution | undefined>;
  notify(event: RunEvent): void;
}

let unsubscribeRunEvents: (() => void) | undefined;

export const useRunStore = create<RunState>((set, get) => ({
  workspaceId: undefined,
  initialized: false,
  loading: false,
  configurations: [],
  defaultConfigurationId: null,
  selectedConfigurationId: undefined,
  detection: undefined,
  executions: [],
  selectedExecutionId: undefined,
  outputChunks: {},
  outputSequences: {},
  busyExecutionId: undefined,
  dialogOpen: false,
  editingConfigurationId: undefined,
  errorMessage: undefined,

  async initialize(workspaceId) {
    if (get().workspaceId === workspaceId && get().initialized) {
      return;
    }

    unsubscribeRunEvents?.();
    unsubscribeRunEvents = window.openCodeDesk.run.onEvent((event) => get().notify(event));
    set({
      workspaceId,
      initialized: false,
      loading: true,
      configurations: [],
      defaultConfigurationId: null,
      selectedConfigurationId: undefined,
      detection: undefined,
      executions: [],
      selectedExecutionId: undefined,
      outputChunks: {},
      outputSequences: {},
      busyExecutionId: undefined,
      errorMessage: undefined,
    });

    try {
      const [detection, configurationList, history] = await Promise.all([
        window.openCodeDesk.run.detect({ workspaceId }),
        window.openCodeDesk.run.list({ workspaceId }),
        window.openCodeDesk.run.listHistory({ workspaceId, limit: 100 }),
      ]);
      if (get().workspaceId !== workspaceId) {
        return;
      }

      const configurations = configurationList.configurations;
      const validConfigurationIds = new Set(
        configurations.map((configuration) => configuration.id),
      );
      const selectedConfigurationId =
        configurationList.defaultConfigurationId !== null &&
        validConfigurationIds.has(configurationList.defaultConfigurationId)
          ? configurationList.defaultConfigurationId
          : configurations[0]?.id;
      const executions = history.reduce(
        (current, execution) => mergeRunExecution(current, execution),
        get().executions,
      );
      const selectedExecutionId =
        get().selectedExecutionId ??
        executions.find((execution) => isActiveRunStatus(execution.status))?.id ??
        executions[0]?.id;

      set({
        configurations,
        defaultConfigurationId: configurationList.defaultConfigurationId,
        selectedConfigurationId,
        detection,
        executions,
        selectedExecutionId,
        initialized: true,
        loading: false,
      });
    } catch (error) {
      if (get().workspaceId === workspaceId) {
        set({ initialized: true, loading: false, errorMessage: readableRunError(error) });
      }
    }
  },

  dispose() {
    unsubscribeRunEvents?.();
    unsubscribeRunEvents = undefined;
    set({ initialized: false, workspaceId: undefined });
  },

  selectConfiguration(configurationId) {
    if (get().configurations.some((configuration) => configuration.id === configurationId)) {
      set({ selectedConfigurationId: configurationId });
    }
  },

  selectExecution(executionId) {
    if (get().executions.some((execution) => execution.id === executionId)) {
      set({ selectedExecutionId: executionId });
    }
  },

  openConfigurationDialog(configurationId) {
    set({
      dialogOpen: true,
      editingConfigurationId: configurationId,
      errorMessage: undefined,
    });
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

  async saveSuggestion(suggestion) {
    return get().saveConfiguration(suggestionToSaveRequest(suggestion));
  },

  async deleteConfiguration(configurationId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
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
            state.defaultConfigurationId === configurationId ? null : state.defaultConfigurationId,
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

  async setDefaultConfiguration(configurationId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const result = await window.openCodeDesk.run.setDefault({
        workspaceId,
        configurationId,
      });
      set({ defaultConfigurationId: result.defaultConfigurationId, loading: false });
    } catch (error) {
      const message = readableRunError(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async proposeStart(configurationId) {
    const workspaceId = get().workspaceId;
    const targetConfigurationId = configurationId ?? get().selectedConfigurationId;
    if (workspaceId === undefined || targetConfigurationId === undefined) {
      return undefined;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const execution = await window.openCodeDesk.run.proposeStart({
        workspaceId,
        configurationId: targetConfigurationId,
      });
      set((state) => ({
        executions: mergeRunExecution(state.executions, execution),
        selectedExecutionId: execution.id,
        busyExecutionId: undefined,
        loading: false,
      }));
      return execution;
    } catch (error) {
      set({ loading: false, errorMessage: readableRunError(error) });
      return undefined;
    }
  },

  async decideStart(executionId, decision) {
    const execution = get().executions.find((item) => item.id === executionId);
    if (execution === undefined || execution.status !== 'pending_approval') {
      return;
    }
    set({ busyExecutionId: executionId, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.run.decideStart({
        executionId,
        expectedApprovalDigest: execution.approvalDigest,
        decision,
      });
      set((state) => ({
        executions: mergeRunExecution(state.executions, updated),
        busyExecutionId: undefined,
      }));
    } catch (error) {
      set({ busyExecutionId: undefined, errorMessage: readableRunError(error) });
    }
  },

  async stop(executionId) {
    const targetId = executionId ?? get().selectedExecutionId;
    if (targetId === undefined) {
      return;
    }
    set({ busyExecutionId: targetId, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.run.stop({ executionId: targetId });
      set((state) => ({
        executions: mergeRunExecution(state.executions, updated),
        busyExecutionId: undefined,
      }));
    } catch (error) {
      set({ busyExecutionId: undefined, errorMessage: readableRunError(error) });
    }
  },

  async restart(executionId) {
    const targetId = executionId ?? get().selectedExecutionId;
    if (targetId === undefined) {
      return undefined;
    }
    set({ busyExecutionId: targetId, errorMessage: undefined });
    try {
      const execution = await window.openCodeDesk.run.restart({ executionId: targetId });
      set((state) => ({
        executions: mergeRunExecution(state.executions, execution),
        selectedExecutionId: execution.id,
        busyExecutionId: undefined,
      }));
      return execution;
    } catch (error) {
      set({ busyExecutionId: undefined, errorMessage: readableRunError(error) });
      return undefined;
    }
  },

  notify(event) {
    const workspaceId = get().workspaceId;
    if (event.type === 'status') {
      if (event.execution.workspaceId !== workspaceId) {
        return;
      }
      set((state) => ({
        executions: mergeRunExecution(state.executions, event.execution),
        selectedExecutionId:
          isActiveRunStatus(event.execution.status) || state.selectedExecutionId === undefined
            ? event.execution.id
            : state.selectedExecutionId,
      }));
      return;
    }

    if (event.workspaceId !== workspaceId) {
      return;
    }
    const lastSequence = get().outputSequences[event.executionId] ?? -1;
    if (event.sequence <= lastSequence) {
      return;
    }
    set((state) => {
      const persistedTail = state.executions.find(
        (execution) => execution.id === event.executionId,
      )?.outputTail;
      const existingChunks =
        state.outputChunks[event.executionId] ??
        (persistedTail === undefined || persistedTail === ''
          ? []
          : [{ stream: 'stdout' as const, sequence: -1, data: persistedTail }]);
      return {
        executions: state.executions.map((execution) =>
          execution.id === event.executionId ? appendRunOutput(execution, event.data) : execution,
        ),
        outputChunks: {
          ...state.outputChunks,
          [event.executionId]: [
            ...existingChunks,
            { stream: event.stream, sequence: event.sequence, data: event.data },
          ].slice(-1_000),
        },
        outputSequences: { ...state.outputSequences, [event.executionId]: event.sequence },
      };
    });
  },
}));
