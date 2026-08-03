import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DebugSession } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileChangeService } from '../changes/file-change.service';
import { ConversationRepository } from '../conversations/conversation.repository';
import { ContextItemRepository } from '../context/context-item.repository';
import { ContextItemService } from '../context/context-item.service';
import { createAppDatabase, type AppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import type { GitService } from '../git/git.service';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { DebugContextService } from './debug-context.service';
import type { DebugSessionService } from './debug-session.service';

const temporaryPaths: string[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('DebugContextService integration', () => {
  it('previews only redacted data and persists selected sections after explicit attach', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-context-'));
    temporaryPaths.push(rootPath);
    await writeFile(
      join(rootPath, 'program.js'),
      ['const apiKey = "source-never-leak";', 'throw new Error("boom");'].join('\n'),
      'utf8',
    );
    await writeFile(
      join(rootPath, 'package.json'),
      JSON.stringify({ dependencies: { zod: '^4.0.0' } }),
      'utf8',
    );

    const database = createAppDatabase(join(rootPath, 'application.sqlite'));
    databases.push(database);
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(rootPath);
    const workspaceService = new WorkspaceService(workspaceRepository, {
      async pickDirectory() {
        return null;
      },
    });
    await workspaceService.openRecent(workspace.id);
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id, { title: '修复异常' });
    const contextRepository = new ContextItemRepository(database);
    const contextItems = new ContextItemService(contextRepository, conversations);
    const session = pausedSession(workspace.id);
    const runtime: Pick<
      DebugSessionService,
      'threads' | 'stackTrace' | 'scopes' | 'variables' | 'evaluate' | 'listWatches'
    > = {
      async threads() {
        return [{ id: 1, name: 'Main' }];
      },
      async stackTrace() {
        return [{ id: 10, name: 'main', relativePath: 'program.js', line: 2, column: 1 }];
      },
      async scopes() {
        return [{ name: 'Locals', variablesReference: 20, expensive: false }];
      },
      async variables() {
        return [
          { name: 'database_password', value: 'variable-never-leak', variablesReference: 0 },
          { name: 'count', value: '3', type: 'number', variablesReference: 0 },
        ];
      },
      async evaluate(input) {
        return {
          expression: input.expression,
          result: 'watch-never-leak',
          variablesReference: 0,
        };
      },
      listWatches() {
        return [
          {
            id: '00000000-0000-4000-8000-000000000006',
            workspaceId: workspace.id,
            expression: 'auth.token',
            createdAt: '2026-08-02T00:00:00.000Z',
            updatedAt: '2026-08-02T00:00:00.000Z',
          },
        ];
      },
    };
    const git: Pick<GitService, 'status' | 'diff'> = {
      async status() {
        return {
          workspaceId: workspace.id,
          isRepository: true,
          branch: 'main',
          ahead: 0,
          behind: 0,
          detached: false,
          clean: false,
          files: [
            {
              path: 'program.js',
              indexStatus: ' ',
              workingTreeStatus: 'M',
              staged: false,
              modified: true,
              untracked: false,
              conflicted: false,
            },
          ],
        };
      },
      async diff(input) {
        const content = input.staged ? '' : '+ password: "git-never-leak"';
        return {
          workspaceId: workspace.id,
          staged: input.staged,
          content,
          bytes: Buffer.byteLength(content),
          truncated: false,
        };
      },
    };
    const changes: Pick<FileChangeService, 'listForConversation'> = {
      listForConversation() {
        return [];
      },
    };
    const service = new DebugContextService(
      { findById: () => session },
      runtime,
      conversations,
      contextItems,
      new WorkspaceFileService(workspaceService),
      git,
      changes,
    );

    const preview = await service.preview({
      sessionId: session.id,
      conversationId: conversation.id,
      locale: 'en-US',
    });
    const serializedPreview = JSON.stringify(preview);
    expect(serializedPreview).not.toMatch(
      /source-never-leak|variable-never-leak|watch-never-leak|git-never-leak|output-never-leak/u,
    );
    expect(preview.totalRedactionCount).toBeGreaterThanOrEqual(5);
    expect(preview.sections.map((section) => section.key)).toEqual(
      expect.arrayContaining(['exception', 'source', 'variables', 'watches', 'git_diff']),
    );

    expect(() =>
      service.attach({
        snapshotId: preview.id,
        expectedDigest: 'b'.repeat(64),
        conversationId: conversation.id,
        selectedSections: ['exception'],
      }),
    ).toThrow(/变化/u);

    const attached = service.attach({
      snapshotId: preview.id,
      expectedDigest: preview.digest,
      conversationId: conversation.id,
      selectedSections: ['exception', 'variables'],
    });
    const stored = contextRepository.list(conversation.id);
    expect(attached.contextItem.sourceKey).toBe(`debug:${session.id}`);
    expect(attached.contextItem.title).toContain('Debug snapshot');
    expect(attached.prompt).toMatch(/^Analyze the debug context/u);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toContain('# User-reviewed debug context');
    expect(stored[0]?.content).toContain('## Exception');
    expect(stored[0]?.content).toContain('Exception: Error');
    expect(stored[0]?.content).not.toMatch(/暂停位置|异常：|调用栈：/u);
    expect(stored[0]?.content).not.toContain('Git Diff');
    expect(JSON.stringify(stored)).not.toMatch(/never-leak/u);
  });
});

function pausedSession(workspaceId: string): DebugSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId,
    configurationId: '00000000-0000-4000-8000-000000000002',
    adapterType: 'node',
    command: {
      configurationId: '00000000-0000-4000-8000-000000000002',
      configurationUpdatedAt: '2026-08-02T00:00:00.000Z',
      configurationName: 'Node 调试',
      projectType: 'node',
      executable: 'node',
      runtimeArgs: [],
      args: ['program.js'],
      workingDirectory: '',
      environmentVariables: [{ name: 'API_KEY', sensitive: true, configured: true }],
      console: 'runOutput',
    },
    status: 'paused',
    riskLevel: 'low',
    riskReasons: [],
    approvalDigest: 'a'.repeat(64),
    pause: {
      threadId: 1,
      frameId: 10,
      reason: 'exception',
      relativePath: 'program.js',
      line: 2,
      column: 1,
      exception: {
        exceptionId: 'Error',
        typeName: 'Error',
        message: 'boom password=exception-never-leak',
        stackTrace: 'Error: boom\n at main (program.js:2:1)',
      },
    },
    outputTail: 'apiKey=output-never-leak\n',
    outputBytes: 30,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:01.000Z',
  };
}
