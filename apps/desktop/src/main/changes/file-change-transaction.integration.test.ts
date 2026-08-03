import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@open-code-desk/tool-core';

import { AgentTaskRepository } from '../agent/agent-task.repository';
import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase, type AppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { ChangeArtifactStore } from './artifact-store';
import { ChangePathResolver } from './change-path-resolver';
import {
  FileChangeTransactionService,
  type FileTransactionFaultInjector,
} from './file-change-transaction.service';
import { FileChangeRepository } from './file-change.repository';
import { FileChangeService } from './file-change.service';

const temporaryPaths: string[] = [];
const databases: AppDatabase[] = [];
const picker: DirectoryPicker = {
  async pickDirectory() {
    return null;
  },
};

interface Fixture {
  readonly workspacePath: string;
  readonly context: ToolExecutionContext;
  readonly repository: FileChangeRepository;
  readonly service: FileChangeService;
  readonly transactions: FileChangeTransactionService;
}

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

async function createFixture(
  files: Readonly<Record<string, string>>,
  faultInjector?: FileTransactionFaultInjector,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'open-code-desk-changes-'));
  temporaryPaths.push(root);
  const workspacePath = join(root, 'workspace');
  const artifactPath = join(root, 'private-artifacts');
  await mkdir(workspacePath);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(workspacePath, path), content, 'utf8');
  }

  const database = createAppDatabase(':memory:');
  databases.push(database);
  const workspaceRepository = new WorkspaceRepository(database);
  const workspace = workspaceRepository.upsert(await realpath(workspacePath));
  const workspaceService = new WorkspaceService(workspaceRepository, picker);
  await workspaceService.openRecent(workspace.id);
  const conversations = new ConversationRepository(database);
  const conversation = conversations.create(workspace.id);
  const tasks = new AgentTaskRepository(database);
  const task = tasks.create(conversation.id, randomUUID());
  const repository = new FileChangeRepository(database);
  const artifacts = new ChangeArtifactStore(artifactPath);
  const paths = new ChangePathResolver(workspaceService);
  const service = new FileChangeService(repository, artifacts, paths, tasks);
  const transactions = new FileChangeTransactionService(
    repository,
    service,
    artifacts,
    paths,
    tasks,
    faultInjector,
  );
  return {
    workspacePath,
    context: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      taskId: task.id,
      callId: randomUUID(),
      signal: new AbortController().signal,
    },
    repository,
    service,
    transactions,
  };
}

function approveAll(fixture: Fixture, changeSetId: string) {
  const aggregate = fixture.service.get(changeSetId);
  return fixture.service.reviewMany(
    changeSetId,
    aggregate.changes.map((change) => ({
      changeId: change.id,
      reviewDigest: change.reviewDigest,
    })),
    'approve',
  );
}

describe('file change transaction', () => {
  it('invalidates approval when the user edits proposed content', async () => {
    const fixture = await createFixture({ 'example.txt': 'baseline\n' });
    const proposed = await fixture.service.proposeUpdate(
      fixture.context,
      'example.txt',
      'first proposal\n',
    );
    const originalChange = proposed.changes[0];
    expect(originalChange).toBeDefined();
    if (originalChange === undefined) {
      return;
    }

    const edited = await fixture.service.editProposal(
      originalChange.id,
      originalChange.reviewDigest,
      'user edited proposal\n',
    );
    expect(edited.changes[0]?.reviewDigest).not.toBe(originalChange.reviewDigest);
    expect(edited.changes[0]?.status).toBe('pending');
    expect(() =>
      fixture.service.review(originalChange.id, originalChange.reviewDigest, 'approve'),
    ).toThrow(/stale|changed/i);
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe('baseline\n');
  });

  it('keeps a proposal off disk until approval, then applies and rolls it back', async () => {
    const fixture = await createFixture({ 'example.txt': 'before\n' });
    const proposed = await fixture.service.proposeUpdate(fixture.context, 'example.txt', 'after\n');

    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe('before\n');
    const approved = approveAll(fixture, proposed.changeSet.id);
    const applied = await fixture.transactions.apply(
      approved.changeSet.id,
      approved.changeSet.applyDigest ?? '',
    );

    expect(applied.changeSet.status).toBe('applied');
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe('after\n');

    const rolledBack = await fixture.transactions.rollback(
      applied.changeSet.id,
      applied.changeSet.applyDigest ?? '',
    );
    expect(rolledBack.changeSet.status).toBe('rolled_back');
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe('before\n');
  });

  it('blocks apply when the target changes after approval', async () => {
    const fixture = await createFixture({ 'example.txt': 'baseline\n' });
    const proposed = await fixture.service.proposeUpdate(
      fixture.context,
      'example.txt',
      'proposal\n',
    );
    const approved = approveAll(fixture, proposed.changeSet.id);
    await writeFile(join(fixture.workspacePath, 'example.txt'), 'user change\n', 'utf8');

    await expect(
      fixture.transactions.apply(approved.changeSet.id, approved.changeSet.applyDigest ?? ''),
    ).rejects.toThrow(/changed after the proposal/);
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe(
      'user change\n',
    );
  });

  it('compensates the first write when a later mutation fails', async () => {
    const fixture = await createFixture(
      { 'a.txt': 'a0\n', 'b.txt': 'b0\n' },
      {
        async beforeMutation(index) {
          if (index === 1) {
            throw new Error('Injected second write failure.');
          }
        },
      },
    );
    let aggregate = await fixture.service.proposeUpdate(fixture.context, 'a.txt', 'a1\n');
    aggregate = await fixture.service.proposeUpdate(fixture.context, 'b.txt', 'b1\n');
    const approved = approveAll(fixture, aggregate.changeSet.id);

    await expect(
      fixture.transactions.apply(approved.changeSet.id, approved.changeSet.applyDigest ?? ''),
    ).rejects.toThrow(/earlier writes were rolled back/);
    expect(await readFile(join(fixture.workspacePath, 'a.txt'), 'utf8')).toBe('a0\n');
    expect(await readFile(join(fixture.workspacePath, 'b.txt'), 'utf8')).toBe('b0\n');
    expect(fixture.service.get(approved.changeSet.id).changeSet.status).toBe('failed');
  });

  it('leaves the workspace unchanged when the target is locked', async () => {
    const fixture = await createFixture(
      { 'locked.txt': 'baseline\n' },
      {
        async beforeMutation() {
          throw Object.assign(new Error('Target file is locked.'), { code: 'EBUSY' });
        },
      },
    );
    const proposed = await fixture.service.proposeUpdate(
      fixture.context,
      'locked.txt',
      'proposal\n',
    );
    const approved = approveAll(fixture, proposed.changeSet.id);

    await expect(
      fixture.transactions.apply(approved.changeSet.id, approved.changeSet.applyDigest ?? ''),
    ).rejects.toThrow(/locked/);
    expect(await readFile(join(fixture.workspacePath, 'locked.txt'), 'utf8')).toBe('baseline\n');
    expect(fixture.service.get(approved.changeSet.id).changeSet.status).toBe('failed');
  });

  it('applies and reverses create, delete, and rename operations as one set', async () => {
    const fixture = await createFixture({
      'delete-me.txt': 'delete\n',
      'rename-me.txt': 'rename\n',
    });
    let aggregate = await fixture.service.proposeCreate(
      fixture.context,
      'created.txt',
      'created\n',
    );
    aggregate = await fixture.service.proposeDelete(fixture.context, 'delete-me.txt');
    aggregate = await fixture.service.proposeRename(
      fixture.context,
      'rename-me.txt',
      'renamed.txt',
    );
    const approved = approveAll(fixture, aggregate.changeSet.id);
    const applied = await fixture.transactions.apply(
      approved.changeSet.id,
      approved.changeSet.applyDigest ?? '',
    );

    expect(await readFile(join(fixture.workspacePath, 'created.txt'), 'utf8')).toBe('created\n');
    await expect(readFile(join(fixture.workspacePath, 'delete-me.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(fixture.workspacePath, 'renamed.txt'), 'utf8')).toBe('rename\n');

    await fixture.transactions.rollback(applied.changeSet.id, applied.changeSet.applyDigest ?? '');
    await expect(readFile(join(fixture.workspacePath, 'created.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(fixture.workspacePath, 'delete-me.txt'), 'utf8')).toBe('delete\n');
    expect(await readFile(join(fixture.workspacePath, 'rename-me.txt'), 'utf8')).toBe('rename\n');
  });

  it('blocks rollback when the applied file was edited again', async () => {
    const fixture = await createFixture({ 'example.txt': 'baseline\n' });
    const proposed = await fixture.service.proposeUpdate(
      fixture.context,
      'example.txt',
      'proposal\n',
    );
    const approved = approveAll(fixture, proposed.changeSet.id);
    const applied = await fixture.transactions.apply(
      approved.changeSet.id,
      approved.changeSet.applyDigest ?? '',
    );
    await writeFile(join(fixture.workspacePath, 'example.txt'), 'later user edit\n', 'utf8');

    await expect(
      fixture.transactions.rollback(applied.changeSet.id, applied.changeSet.applyDigest ?? ''),
    ).rejects.toThrow(/rollback was blocked/);
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe(
      'later user edit\n',
    );
  });

  it('recovers an interrupted apply by restoring the recorded baseline', async () => {
    const fixture = await createFixture({ 'example.txt': 'baseline\n' });
    const proposed = await fixture.service.proposeUpdate(
      fixture.context,
      'example.txt',
      'proposal\n',
    );
    const approved = approveAll(fixture, proposed.changeSet.id);
    fixture.repository.updateSet(approved.changeSet.id, { status: 'applying' });
    await writeFile(join(fixture.workspacePath, 'example.txt'), 'proposal\n', 'utf8');

    expect(await fixture.transactions.recoverInterrupted()).toBe(1);
    expect(await readFile(join(fixture.workspacePath, 'example.txt'), 'utf8')).toBe('baseline\n');
    expect(fixture.service.get(approved.changeSet.id).changeSet.status).toBe('rolled_back');
  });
});
