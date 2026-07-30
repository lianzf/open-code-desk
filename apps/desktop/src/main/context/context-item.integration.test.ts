import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { ContextItemRepository } from './context-item.repository';
import { ContextItemService } from './context-item.service';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

describe('conversation context persistence', () => {
  it('migrates, upserts source-backed items, persists arbitrary items, and deletes by conversation', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-context-'));
    temporaryPaths.push(rootPath);
    const databasePath = join(rootPath, 'context.sqlite');
    const database = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(database).upsert(rootPath);
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id);
    const repository = new ContextItemRepository(database);
    const service = new ContextItemService(repository, conversations);

    const first = service.save({
      conversationId: conversation.id,
      type: 'file',
      title: 'src/example.ts',
      content: 'const version = 1;',
      priority: 90,
      sourceKey: 'file:src/example.ts',
    });
    const updated = service.save({
      conversationId: conversation.id,
      type: 'file',
      title: 'src/example.ts',
      content: 'const version = 2;',
      priority: 95,
      sourceKey: 'file:src/example.ts',
    });
    const pasted = service.save({
      conversationId: conversation.id,
      type: 'text',
      title: 'Reproduction notes',
      content: 'A user-provided reproduction marker.',
      priority: 60,
    });

    expect(updated.id).toBe(first.id);
    expect(updated.content).toContain('version = 2');
    expect(updated.tokenEstimate).toBeGreaterThan(0);
    expect(service.list(conversation.id)).toHaveLength(2);
    expect(database.client.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    database.close();

    const reopened = createAppDatabase(databasePath);
    const reopenedRepository = new ContextItemRepository(reopened);
    expect(reopenedRepository.list(conversation.id)).toMatchObject([
      { id: first.id, priority: 95, content: 'const version = 2;' },
      { id: pasted.id, priority: 60 },
    ]);
    expect(reopenedRepository.delete(conversation.id, first.id)).toBe(true);
    expect(reopenedRepository.delete(crypto.randomUUID(), pasted.id)).toBe(false);
    expect(reopenedRepository.list(conversation.id)).toHaveLength(1);
    reopened.close();
  });
});
