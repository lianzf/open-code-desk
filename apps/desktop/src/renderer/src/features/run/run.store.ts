import type {
  CompoundRunConfiguration,
  CompoundRunProposal,
  CompoundRunSession,
  ProjectDetection,
  ProjectTask,
  RunApprovalDecision,
  RunConfiguration,
  RunConfigurationDraft,
  RunEvent,
  RunExecution,
  SaveRunConfigurationRequest,
} from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import { createRunCompoundActions } from './run-compound-actions';
import { createRunConfigurationActions } from './run-configuration-actions';
import { currentRendererLocale } from '../settings/error-i18n';
import {
  appendRunOutput,
  isActiveRunStatus,
  mergeRunExecution,
  readableRunError,
  type RunOutputChunk,
} from './run-store-helpers';

export { appendRunOutput, mergeRunExecution } from './run-store-helpers';

export interface RunState {
  readonly workspaceId: string | undefined;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly configurations: ReadonlyArray<RunConfiguration>;
  readonly compoundConfigurations: ReadonlyArray<CompoundRunConfiguration>;
  readonly compoundSessions: ReadonlyArray<CompoundRunSession>;
  readonly pendingCompoundProposal: CompoundRunProposal | undefined;
  readonly projectTasks: ReadonlyArray<ProjectTask>;
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
  readonly compoundDialogOpen: boolean;
  readonly errorMessage: string | undefined;
  initialize(workspaceId: string): Promise<void>;
  dispose(): void;
  selectConfiguration(configurationId: string): void;
  selectExecution(executionId: string): void;
  openConfigurationDialog(configurationId?: string): void;
  closeConfigurationDialog(): void;
  openCompoundDialog(): void;
  closeCompoundDialog(): void;
  saveConfiguration(input: SaveRunConfigurationRequest): Promise<RunConfiguration>;
  saveSuggestion(suggestion: RunConfigurationDraft): Promise<RunConfiguration>;
  deleteConfiguration(configurationId: string): Promise<void>;
  duplicateConfiguration(configurationId: string): Promise<RunConfiguration>;
  saveCompoundConfiguration(input: {
    readonly id?: string;
    readonly name: string;
    readonly configurationIds: ReadonlyArray<string>;
    readonly stopAllOnSingleFailure: boolean;
  }): Promise<CompoundRunConfiguration>;
  deleteCompoundConfiguration(compoundConfigurationId: string): Promise<void>;
  proposeCompoundStart(compoundConfigurationId: string): Promise<void>;
  decideCompound(decision: RunApprovalDecision): Promise<void>;
  stopCompound(sessionId: string): Promise<void>;
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
  compoundConfigurations: [],
  compoundSessions: [],
  pendingCompoundProposal: undefined,
  projectTasks: [],
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
  compoundDialogOpen: false,
  errorMessage: undefined,

  ...createRunConfigurationActions(set, get),
  ...createRunCompoundActions(set, get),

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
      compoundConfigurations: [],
      compoundSessions: [],
      pendingCompoundProposal: undefined,
      projectTasks: [],
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
      const [
        detection,
        configurationList,
        history,
        projectTasks,
        compoundConfigurations,
        compoundSessions,
      ] = await Promise.all([
        window.openCodeDesk.run.detect({ workspaceId, locale: currentRendererLocale() }),
        window.openCodeDesk.run.list({ workspaceId }),
        window.openCodeDesk.run.listHistory({ workspaceId, limit: 100 }),
        window.openCodeDesk.projectTasks.list({ workspaceId }),
        window.openCodeDesk.run.listCompounds({ workspaceId }),
        window.openCodeDesk.run.listCompoundSessions({ workspaceId }),
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
        compoundConfigurations,
        compoundSessions,
        projectTasks,
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
