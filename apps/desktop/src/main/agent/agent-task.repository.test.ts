import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { AgentTaskPlan } from './agent-task-plan';
import { AgentTaskRepository } from './agent-task.repository';

describe('AgentTaskRepository recovery', () => {
  it('preserves the last checkpoint, marks interruption retryable, and increments attempts', () => {
    const database = createAppDatabase(':memory:');
    const workspace = new WorkspaceRepository(database).upsert(process.cwd());
    const conversation = new ConversationRepository(database).create(workspace.id);
    const repository = new AgentTaskRepository(database);
    const task = repository.create(conversation.id, randomUUID());
    const plan = new AgentTaskPlan();
    plan.transition('analyzing');
    const checkpoint = plan.transition('planning');
    repository.update(task.id, 'planning', { checkpoint });

    expect(repository.recoverInterrupted()).toBe(1);
    expect(repository.findById(task.id)).toMatchObject({
      status: 'failed',
      attempt: 1,
      checkpoint,
      error: { retryable: true },
    });
    expect(repository.create(conversation.id, randomUUID()).attempt).toBe(2);
    database.close();
  });
});
