import { describe, expect, it } from 'vitest';

import { AgentTaskPlan, completeAgentTaskCheckpoint } from './agent-task-plan';

describe('AgentTaskPlan', () => {
  it('records completed, active, failed, and recovered task steps', () => {
    const plan = new AgentTaskPlan();
    plan.setRound(1);
    plan.transition('analyzing');
    plan.transition('planning');
    const executing = plan.transition('executing_tool', '执行工具 read_file');
    const failed = plan.transition('failed');
    const recovered = completeAgentTaskCheckpoint(failed, '用户重试任务');

    expect(executing.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'in_progress',
    ]);
    expect(failed.steps.at(-1)).toMatchObject({
      label: '执行工具 read_file',
      status: 'failed',
    });
    expect(recovered.steps.at(-1)).toMatchObject({
      label: '用户重试任务',
      status: 'completed',
    });
  });
});
