import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ToolDispatcher, ToolRegistry } from '@open-code-desk/tool-core';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase, type AppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { AgentTaskRepository } from './agent-task.repository';
import type { ToolApprovalRequestedEvent } from './tool-approval-lifecycle';
import { ToolApprovalService } from './tool-approval.service';
import { ToolCallRepository } from './tool-call.repository';

describe('ToolApprovalService integration', () => {
  let database: AppDatabase;
  let directory: string;

  beforeEach(async () => {
    database = createAppDatabase(':memory:');
    directory = await mkdtemp(join(tmpdir(), 'open-code-desk-tool-approval-'));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists the validated request and prevents execution until the digest is approved', async () => {
    const workspace = new WorkspaceRepository(database).upsert(await realpath(directory));
    const conversation = new ConversationRepository(database).create(workspace.id, {
      title: 'Tool approval',
    });
    const task = new AgentTaskRepository(database).create(conversation.id, crypto.randomUUID());
    const calls = new ToolCallRepository(database);
    const approvals = new ToolApprovalService(calls);
    const registry = new ToolRegistry();
    const execute = vi.fn(async (input: { readonly path: string }) => input.path);
    registry.register({
      name: 'read_file',
      description: 'Read one file',
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      permissionLevel: 'read',
      execute,
    });
    const dispatcher = new ToolDispatcher(
      registry,
      {
        decide: () => ({
          outcome: 'require_approval',
          reason: 'Read tools require approval.',
        }),
      },
      calls,
      approvals,
    );
    const eventPromise = new Promise<ToolApprovalRequestedEvent>((resolve) => {
      approvals.subscribe(task.id, (event) => {
        if (event.type === 'tool_approval_requested') {
          resolve(event);
        }
      });
    });
    const context = {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      taskId: task.id,
      callId: crypto.randomUUID(),
      modelCallId: crypto.randomUUID(),
      signal: new AbortController().signal,
    };
    const resultPromise = dispatcher.execute('read_file', { path: 'README.md' }, context);
    const event = await eventPromise;

    expect(execute).not.toHaveBeenCalled();
    expect(event.call).toMatchObject({
      id: context.callId,
      status: 'pending',
      input: { path: 'README.md' },
    });
    expect(event.call.approvalDigest).toHaveLength(64);
    expect(() =>
      approvals.decide({
        callId: context.callId,
        expectedApprovalDigest: '0'.repeat(64),
        decision: 'approve',
      }),
    ).toThrow('digest is stale');
    expect(execute).not.toHaveBeenCalled();

    approvals.decide({
      callId: context.callId,
      expectedApprovalDigest: event.call.approvalDigest ?? '',
      decision: 'approve',
    });
    await expect(resultPromise).resolves.toEqual({ ok: true, value: 'README.md' });
    expect(execute).toHaveBeenCalledOnce();
    expect(calls.findById(context.callId)?.status).toBe('completed');
    approvals.close();
  });

  it('records rejection and never executes the tool', async () => {
    const workspace = new WorkspaceRepository(database).upsert(await realpath(directory));
    const conversation = new ConversationRepository(database).create(workspace.id, {
      title: 'Tool rejection',
    });
    const task = new AgentTaskRepository(database).create(conversation.id, crypto.randomUUID());
    const calls = new ToolCallRepository(database);
    const approvals = new ToolApprovalService(calls);
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => 'unexpected');
    registry.register({
      name: 'read_file',
      description: 'Read one file',
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      permissionLevel: 'read',
      execute,
    });
    const dispatcher = new ToolDispatcher(
      registry,
      { decide: () => ({ outcome: 'require_approval', reason: 'Approval required.' }) },
      calls,
      approvals,
    );
    const eventPromise = new Promise<ToolApprovalRequestedEvent>((resolve) => {
      approvals.subscribe(task.id, (event) => {
        if (event.type === 'tool_approval_requested') {
          resolve(event);
        }
      });
    });
    const callId = crypto.randomUUID();
    const resultPromise = dispatcher.execute(
      'read_file',
      { path: 'README.md' },
      {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        taskId: task.id,
        callId,
        signal: new AbortController().signal,
      },
    );
    const event = await eventPromise;
    approvals.decide({
      callId,
      expectedApprovalDigest: event.call.approvalDigest ?? '',
      decision: 'reject',
    });

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_APPROVAL_REJECTED' },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(calls.findById(callId)).toMatchObject({
      status: 'rejected',
      error: { code: 'TOOL_APPROVAL_REJECTED' },
    });
    approvals.close();
  });
});
