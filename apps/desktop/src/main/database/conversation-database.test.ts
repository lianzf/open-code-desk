import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentTaskRepository } from '../agent/agent-task.repository';
import { ToolCallRepository } from '../agent/tool-call.repository';
import { ConversationRepository } from '../conversations/conversation.repository';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { createAppDatabase } from './database';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

describe('conversation database', () => {
  it('persists messages, tool calls, and interrupted task recovery across restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-code-desk-conversation-db-'));
    temporaryPaths.push(directory);
    const databasePath = join(directory, 'application.sqlite');
    const canonicalPath = await realpath(directory);

    const firstDatabase = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(firstDatabase).upsert(canonicalPath);
    const conversations = new ConversationRepository(firstDatabase);
    const conversation = conversations.create(workspace.id, { title: 'Persisted task' });
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'Inspect README.md',
    });
    const tasks = new AgentTaskRepository(firstDatabase);
    const task = tasks.create(conversation.id, randomUUID());
    new ToolCallRepository(firstDatabase).recordRejected(
      {
        id: randomUUID(),
        workspaceId: workspace.id,
        taskId: task.id,
        conversationId: conversation.id,
        toolName: 'unknown_tool',
        untrustedInput: {},
      },
      {
        code: 'TOOL_NOT_FOUND',
        message: 'Unknown tool',
        retryable: false,
      },
    );
    firstDatabase.close();

    const reopenedDatabase = createAppDatabase(databasePath);
    const reopenedConversations = new ConversationRepository(reopenedDatabase);
    const reopenedTasks = new AgentTaskRepository(reopenedDatabase);

    expect(reopenedConversations.list(workspace.id)).toHaveLength(1);
    expect(reopenedConversations.listMessages(conversation.id)).toMatchObject([
      { role: 'user', content: 'Inspect README.md', sequence: 1 },
    ]);
    expect(reopenedTasks.recoverInterrupted()).toBe(1);
    expect(reopenedTasks.latestForConversation(conversation.id)).toMatchObject({
      status: 'failed',
      error: { retryable: true },
    });
    expect(
      new ToolCallRepository(reopenedDatabase).listForConversation(conversation.id),
    ).toMatchObject([{ toolName: 'unknown_tool', status: 'rejected' }]);
    const version = reopenedDatabase.client.prepare('PRAGMA user_version').get() as {
      readonly user_version: number;
    };
    expect(version.user_version).toBeGreaterThanOrEqual(1);
    reopenedDatabase.close();
  });
});
