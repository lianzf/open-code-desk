import type {
  AgentStatus,
  AgentTaskCheckpoint,
  AgentTaskStep,
  AgentTaskStepStatus,
} from '@open-code-desk/domain';

function terminalStepStatus(status: AgentStatus): AgentTaskStepStatus {
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'completed';
}

function defaultLabel(status: AgentStatus): string {
  const labels: Readonly<Record<AgentStatus, string>> = {
    idle: '等待任务',
    analyzing: '分析用户需求',
    planning: '构建上下文并制定下一步',
    waiting_for_approval: '等待用户授权或审核',
    executing_tool: '执行工具',
    editing_files: '应用已批准的文件修改',
    running_tests: '运行测试命令',
    completed: '完成任务',
    failed: '任务失败',
    cancelled: '任务已取消',
  };
  return labels[status];
}

export class AgentTaskPlan {
  readonly #steps: AgentTaskStep[] = [];
  #round = 0;

  public setRound(round: number): void {
    this.#round = Math.max(this.#round, round);
  }

  public transition(status: AgentStatus, label = defaultLabel(status)): AgentTaskCheckpoint {
    const now = new Date().toISOString();
    const previous = this.#steps.at(-1);
    if (previous?.status === 'in_progress') {
      this.#steps[this.#steps.length - 1] = {
        ...previous,
        status: terminalStepStatus(status),
        completedAt: now,
      };
    }

    if (status === 'completed') {
      this.#steps.push({
        id: `step-${this.#steps.length + 1}`,
        label,
        status: 'completed',
        startedAt: now,
        completedAt: now,
      });
    } else if (status !== 'failed' && status !== 'cancelled' && status !== 'idle') {
      this.#steps.push({
        id: `step-${this.#steps.length + 1}`,
        label,
        status: 'in_progress',
        startedAt: now,
      });
    }

    if (this.#steps.length > 50) {
      this.#steps.splice(0, this.#steps.length - 50);
    }
    return this.checkpoint(now);
  }

  public checkpoint(updatedAt = new Date().toISOString()): AgentTaskCheckpoint {
    return {
      round: this.#round,
      steps: this.#steps.map((step) => ({ ...step })),
      updatedAt,
    };
  }
}

export function completeAgentTaskCheckpoint(
  checkpoint: AgentTaskCheckpoint | undefined,
  label: string,
): AgentTaskCheckpoint {
  const now = new Date().toISOString();
  return {
    round: checkpoint?.round ?? 0,
    steps: [
      ...(checkpoint?.steps ?? []).map((step) =>
        step.status === 'in_progress'
          ? { ...step, status: 'completed' as const, completedAt: now }
          : step,
      ),
      {
        id: `step-${(checkpoint?.steps.length ?? 0) + 1}`,
        label,
        status: 'completed',
        startedAt: now,
        completedAt: now,
      },
    ],
    updatedAt: now,
  };
}
