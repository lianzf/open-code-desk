import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AgentTaskRepository } from '../agent/agent-task.repository';
import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { AuditLogService, redactAuditText } from './audit-log.service';

describe('AuditLogService', () => {
  it('persists queryable events while redacting credential-shaped values', () => {
    const database = createAppDatabase(':memory:');
    const workspace = new WorkspaceRepository(database).upsert(process.cwd());
    const conversation = new ConversationRepository(database).create(workspace.id);
    const task = new AgentTaskRepository(database).create(conversation.id, randomUUID());
    const audit = new AuditLogService(database);

    audit.record({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      taskId: task.id,
      actor: 'agent',
      category: 'tool',
      action: 'fixture.execute',
      outcome: 'failed',
      summary: 'Provider returned Bearer private-token-value.',
      metadata: {
        apiKey: 'sk-private-fixture-value',
        note: 'request used sk-private-fixture-value',
        retryable: true,
      },
    });

    expect(audit.list({ workspaceId: workspace.id, limit: 20 })).toMatchObject([
      {
        conversationId: conversation.id,
        taskId: task.id,
        summary: 'Provider returned Bearer [REDACTED]',
        metadata: {
          apiKey: '[REDACTED]',
          note: 'request used [REDACTED]',
          retryable: true,
        },
      },
    ]);
    expect(
      audit.list({
        workspaceId: workspace.id,
        conversationId: randomUUID(),
        limit: 20,
      }),
    ).toEqual([]);
    expect(database.client.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    database.close();
  });

  it('redacts common authorization and credential forms', () => {
    expect(redactAuditText('Bearer abc sk-example-secret-value')).toBe(
      'Bearer [REDACTED] [REDACTED]',
    );
  });
});
