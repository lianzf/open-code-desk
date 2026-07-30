import type { CommandExecution, PermissionRule } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

interface CommandState {
  readonly conversationId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly commands: ReadonlyArray<CommandExecution>;
  readonly rules: ReadonlyArray<PermissionRule>;
  readonly busyCommandId: string | undefined;
  readonly errorMessage: string | undefined;
  initialize(conversationId: string, workspaceId: string): Promise<void>;
  notify(command: CommandExecution): void;
  appendOutput(commandId: string, chunk: string): void;
  decide(
    commandId: string,
    decision: 'approve' | 'reject',
    rememberExecutable: boolean,
  ): Promise<void>;
  cancel(commandId: string): Promise<void>;
  setNetworkAccess(allowed: boolean): Promise<void>;
  setReadAutoAllow(allowed: boolean): Promise<void>;
  addExecutableRule(
    kind: 'allow_executable' | 'deny_executable',
    executable: string,
    cwd: string,
  ): Promise<void>;
  addBlockedPath(relativePath: string): Promise<void>;
  grantExternalDirectory(): Promise<void>;
  deleteRule(ruleId: string): Promise<void>;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
  return '命令操作失败。';
}

export function mergeCommandExecution(
  commands: ReadonlyArray<CommandExecution>,
  updated: CommandExecution,
): ReadonlyArray<CommandExecution> {
  const statusRank: Readonly<Record<CommandExecution['status'], number>> = {
    pending_approval: 0,
    approved: 1,
    running: 2,
    completed: 3,
    failed: 3,
    rejected: 3,
    cancelled: 3,
    timed_out: 3,
  };
  const current = commands.find((command) => command.id === updated.id);
  if (current === undefined) {
    return [updated, ...commands];
  }
  const shouldReplace =
    statusRank[updated.status] > statusRank[current.status] ||
    (statusRank[updated.status] === statusRank[current.status] &&
      updated.updatedAt >= current.updatedAt);
  return commands.map((command) =>
    command.id === updated.id && shouldReplace ? updated : command,
  );
}

export const useCommandStore = create<CommandState>((set, get) => ({
  conversationId: undefined,
  workspaceId: undefined,
  commands: [],
  rules: [],
  busyCommandId: undefined,
  errorMessage: undefined,

  async initialize(conversationId, workspaceId) {
    if (get().conversationId === conversationId && get().workspaceId === workspaceId) {
      return;
    }
    set({
      conversationId,
      workspaceId,
      commands: [],
      rules: [],
      busyCommandId: undefined,
      errorMessage: undefined,
    });
    try {
      const [commands, rules] = await Promise.all([
        window.openCodeDesk.commands.listForConversation({ conversationId }),
        window.openCodeDesk.permissions.listRules({ workspaceId }),
      ]);
      if (get().conversationId === conversationId) {
        set({ commands, rules });
      }
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  notify(command) {
    if (command.conversationId !== get().conversationId) {
      return;
    }
    set((state) => ({
      commands: mergeCommandExecution(state.commands, command),
      errorMessage: undefined,
    }));
  },

  appendOutput(commandId, chunk) {
    set((state) => ({
      commands: state.commands.map((command) => {
        if (command.id !== commandId) {
          return command;
        }
        const outputTail = `${command.outputTail}${chunk}`.slice(-100_000);
        return {
          ...command,
          outputTail,
          outputBytes: command.outputBytes + new TextEncoder().encode(chunk).byteLength,
        };
      }),
    }));
  },

  async decide(commandId, decision, rememberExecutable) {
    const command = get().commands.find((item) => item.id === commandId);
    if (command === undefined || command.status !== 'pending_approval') {
      return;
    }
    set({ busyCommandId: commandId, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.commands.decide({
        commandId,
        expectedApprovalDigest: command.approvalDigest,
        decision,
        rememberExecutable,
      });
      set((state) => ({
        commands: mergeCommandExecution(state.commands, updated),
        busyCommandId: undefined,
      }));
      const workspaceId = get().workspaceId;
      if (rememberExecutable && workspaceId !== undefined) {
        const rules = await window.openCodeDesk.commands.listRules({ workspaceId });
        set({ rules });
      }
    } catch (error) {
      set({ busyCommandId: undefined, errorMessage: readableError(error) });
    }
  },

  async cancel(commandId) {
    set({ busyCommandId: commandId, errorMessage: undefined });
    try {
      await window.openCodeDesk.commands.cancel({ commandId });
      set({ busyCommandId: undefined });
    } catch (error) {
      set({ busyCommandId: undefined, errorMessage: readableError(error) });
    }
  },

  async setNetworkAccess(allowed) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    try {
      const rules = await window.openCodeDesk.commands.setNetworkAccess({
        workspaceId,
        allowed,
      });
      set({ rules, errorMessage: undefined });
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async setReadAutoAllow(allowed) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    try {
      const rules = await window.openCodeDesk.permissions.setReadAutoAllow({
        workspaceId,
        allowed,
      });
      set({ rules, errorMessage: undefined });
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async addExecutableRule(kind, executable, cwd) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined || executable.trim() === '') {
      return;
    }
    try {
      const saved = await window.openCodeDesk.commands.upsertExecutableRule({
        workspaceId,
        kind,
        executable,
        cwd,
      });
      set((state) => ({
        rules: [...state.rules.filter((rule) => rule.id !== saved.id), saved],
        errorMessage: undefined,
      }));
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async addBlockedPath(relativePath) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined || relativePath.trim() === '') {
      return;
    }
    try {
      const saved = await window.openCodeDesk.permissions.addBlockedPath({
        workspaceId,
        relativePath,
      });
      set((state) => ({
        rules: [...state.rules.filter((rule) => rule.id !== saved.id), saved],
        errorMessage: undefined,
      }));
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async grantExternalDirectory() {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    try {
      const saved = await window.openCodeDesk.permissions.grantExternalDirectory({
        workspaceId,
      });
      if (saved !== null) {
        set((state) => ({
          rules: [...state.rules.filter((rule) => rule.id !== saved.id), saved],
          errorMessage: undefined,
        }));
      }
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async deleteRule(ruleId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    try {
      await window.openCodeDesk.permissions.deleteRule({ workspaceId, ruleId });
      set((state) => ({
        rules: state.rules.filter((rule) => rule.id !== ruleId),
        errorMessage: undefined,
      }));
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },
}));
