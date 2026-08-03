import type {
  ProjectTask,
  ProjectTaskEvent,
  ProjectTaskExecution,
  RunApprovalDecision,
  SaveProjectTaskRequest,
} from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import { readableRunError, type RunOutputChunk } from '../run/run-store-helpers';

interface ProjectTaskState {
  readonly workspaceId: string | undefined;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly selectedTaskId: string | undefined;
  readonly executions: ReadonlyArray<ProjectTaskExecution>;
  readonly selectedExecutionId: string | undefined;
  readonly outputChunks: Readonly<Record<string, ReadonlyArray<RunOutputChunk>>>;
  readonly outputSequences: Readonly<Record<string, number>>;
  readonly busyExecutionId: string | undefined;
  readonly dialogOpen: boolean;
  readonly editingTaskId: string | undefined;
  readonly errorMessage: string | undefined;
  initialize(workspaceId: string): Promise<void>;
  dispose(): void;
  selectTask(taskId: string): void;
  selectExecution(executionId: string): void;
  openDialog(taskId?: string): void;
  closeDialog(): void;
  save(input: SaveProjectTaskRequest): Promise<ProjectTask>;
  delete(taskId: string): Promise<void>;
  proposeStart(taskId?: string): Promise<ProjectTaskExecution | undefined>;
  decideStart(executionId: string, decision: RunApprovalDecision): Promise<void>;
  stop(executionId?: string): Promise<void>;
  restart(executionId?: string): Promise<ProjectTaskExecution | undefined>;
  notify(event: ProjectTaskEvent): void;
}

let unsubscribeProjectTaskEvents: (() => void) | undefined;

export const useProjectTaskStore = create<ProjectTaskState>((set, get) => ({
  workspaceId: undefined,
  initialized: false,
  loading: false,
  tasks: [],
  selectedTaskId: undefined,
  executions: [],
  selectedExecutionId: undefined,
  outputChunks: {},
  outputSequences: {},
  busyExecutionId: undefined,
  dialogOpen: false,
  editingTaskId: undefined,
  errorMessage: undefined,

  async initialize(workspaceId) {
    if (get().workspaceId === workspaceId && get().initialized) return;
    unsubscribeProjectTaskEvents?.();
    unsubscribeProjectTaskEvents = window.openCodeDesk.projectTasks.onEvent((event) =>
      get().notify(event),
    );
    set({
      workspaceId,
      initialized: false,
      loading: true,
      tasks: [],
      selectedTaskId: undefined,
      executions: [],
      selectedExecutionId: undefined,
      outputChunks: {},
      outputSequences: {},
      busyExecutionId: undefined,
      errorMessage: undefined,
    });
    try {
      const [tasks, history] = await Promise.all([
        window.openCodeDesk.projectTasks.list({ workspaceId }),
        window.openCodeDesk.projectTasks.listHistory({ workspaceId, limit: 100 }),
      ]);
      if (get().workspaceId !== workspaceId) return;
      const executions = history.reduce(mergeProjectTaskExecution, get().executions);
      set({
        tasks,
        selectedTaskId: tasks[0]?.id,
        executions,
        selectedExecutionId:
          executions.find((execution) => isActiveStatus(execution.status))?.id ?? executions[0]?.id,
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
    unsubscribeProjectTaskEvents?.();
    unsubscribeProjectTaskEvents = undefined;
    set({ initialized: false, workspaceId: undefined });
  },

  selectTask(taskId) {
    if (get().tasks.some((task) => task.id === taskId)) set({ selectedTaskId: taskId });
  },

  selectExecution(executionId) {
    if (get().executions.some((execution) => execution.id === executionId)) {
      set({ selectedExecutionId: executionId });
    }
  },

  openDialog(taskId) {
    set({ dialogOpen: true, editingTaskId: taskId, errorMessage: undefined });
  },

  closeDialog() {
    set({ dialogOpen: false, editingTaskId: undefined });
  },

  async save(input) {
    set({ loading: true, errorMessage: undefined });
    try {
      const saved = await window.openCodeDesk.projectTasks.save(input);
      set((state) => ({
        tasks: [saved, ...state.tasks.filter((task) => task.id !== saved.id)].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        selectedTaskId: saved.id,
        editingTaskId: saved.id,
        loading: false,
      }));
      return saved;
    } catch (error) {
      const message = readableRunError(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async delete(taskId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) return;
    set({ loading: true, errorMessage: undefined });
    try {
      await window.openCodeDesk.projectTasks.delete({ workspaceId, taskId });
      set((state) => {
        const tasks = state.tasks.filter((task) => task.id !== taskId);
        return {
          tasks,
          selectedTaskId: state.selectedTaskId === taskId ? tasks[0]?.id : state.selectedTaskId,
          dialogOpen: false,
          editingTaskId: undefined,
          loading: false,
        };
      });
    } catch (error) {
      const message = readableRunError(error);
      set({ loading: false, errorMessage: message });
      throw new Error(message);
    }
  },

  async proposeStart(taskId) {
    const workspaceId = get().workspaceId;
    const targetTaskId = taskId ?? get().selectedTaskId;
    if (workspaceId === undefined || targetTaskId === undefined) return undefined;
    set({ loading: true, errorMessage: undefined });
    try {
      const execution = await window.openCodeDesk.projectTasks.proposeStart({
        workspaceId,
        taskId: targetTaskId,
      });
      set((state) => ({
        executions: mergeProjectTaskExecution(state.executions, execution),
        selectedExecutionId: execution.id,
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
    if (execution === undefined || execution.status !== 'pending_approval') return;
    set({ busyExecutionId: executionId, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.projectTasks.decideStart({
        executionId,
        decision,
        expectedApprovalDigest: execution.approvalDigest,
      });
      set((state) => ({
        executions: mergeProjectTaskExecution(state.executions, updated),
        busyExecutionId: undefined,
      }));
    } catch (error) {
      set({ busyExecutionId: undefined, errorMessage: readableRunError(error) });
    }
  },

  async stop(executionId) {
    const targetId = executionId ?? get().selectedExecutionId;
    if (targetId === undefined) return;
    set({ busyExecutionId: targetId, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.projectTasks.stop({ executionId: targetId });
      set((state) => ({
        executions: mergeProjectTaskExecution(state.executions, updated),
        busyExecutionId: undefined,
      }));
    } catch (error) {
      set({ busyExecutionId: undefined, errorMessage: readableRunError(error) });
    }
  },

  async restart(executionId) {
    const targetId = executionId ?? get().selectedExecutionId;
    if (targetId === undefined) return undefined;
    set({ busyExecutionId: targetId, errorMessage: undefined });
    try {
      const execution = await window.openCodeDesk.projectTasks.restart({ executionId: targetId });
      set((state) => ({
        executions: mergeProjectTaskExecution(state.executions, execution),
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
      if (event.execution.workspaceId !== workspaceId) return;
      set((state) => ({
        executions: mergeProjectTaskExecution(state.executions, event.execution),
        selectedExecutionId:
          isActiveStatus(event.execution.status) || state.selectedExecutionId === undefined
            ? event.execution.id
            : state.selectedExecutionId,
      }));
      return;
    }
    if (event.workspaceId !== workspaceId) return;
    const lastSequence = get().outputSequences[event.executionId] ?? -1;
    if (event.sequence <= lastSequence) return;
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
          execution.id === event.executionId
            ? appendProjectTaskOutput(execution, event.data)
            : execution,
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

const statusRank: Readonly<Record<ProjectTaskExecution['status'], number>> = {
  pending_approval: 0,
  starting: 1,
  running: 2,
  stopping: 3,
  stopped: 4,
  completed: 4,
  failed: 4,
  rejected: 4,
};

export function mergeProjectTaskExecution(
  executions: ReadonlyArray<ProjectTaskExecution>,
  updated: ProjectTaskExecution,
): ReadonlyArray<ProjectTaskExecution> {
  const current = executions.find((execution) => execution.id === updated.id);
  if (current === undefined) {
    return [updated, ...executions].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }
  const isNewer = updated.updatedAt > current.updatedAt;
  const isFurther =
    updated.updatedAt === current.updatedAt &&
    (statusRank[updated.status] > statusRank[current.status] ||
      (statusRank[updated.status] === statusRank[current.status] &&
        updated.outputBytes >= current.outputBytes));
  if (!isNewer && !isFurther) return executions;
  return executions
    .map((execution) => (execution.id === updated.id ? updated : execution))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function appendProjectTaskOutput(
  execution: ProjectTaskExecution,
  chunk: string,
): ProjectTaskExecution {
  return {
    ...execution,
    outputTail: `${execution.outputTail}${chunk}`.slice(-65_536),
    outputBytes: execution.outputBytes + new TextEncoder().encode(chunk).byteLength,
  };
}

function isActiveStatus(status: ProjectTaskExecution['status']): boolean {
  return ['pending_approval', 'starting', 'running', 'stopping'].includes(status);
}
