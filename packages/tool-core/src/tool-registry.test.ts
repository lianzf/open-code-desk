import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  DefaultPermissionPolicy,
  ToolDispatcher,
  ToolRegistry,
  type PermissionApprovalOutcome,
  type ToolExecutionObserver,
} from './index';

const tool = {
  name: 'read_file',
  description: 'Read a file',
  inputSchema: z.object({ path: z.string().min(1) }).strict(),
  permissionLevel: 'read' as const,
  async execute(input: { readonly path: string }) {
    return { path: input.path };
  },
};

const observer: ToolExecutionObserver = {
  started: vi.fn(async () => undefined),
  completed: vi.fn(async () => undefined),
};

describe('ToolRegistry and ToolDispatcher', () => {
  it('registers tools and emits JSON schema definitions', () => {
    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.get('read_file')).toBeDefined();
    expect(registry.definitions()[0]).toMatchObject({
      name: 'read_file',
      permissionLevel: 'read',
      inputSchema: { type: 'object' },
    });
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });

  it('validates untrusted input before executing a tool', async () => {
    const registry = new ToolRegistry();
    registry.register(tool);
    const dispatcher = new ToolDispatcher(registry, new DefaultPermissionPolicy(), observer);
    const context = {
      workspaceId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      callId: crypto.randomUUID(),
      signal: new AbortController().signal,
    };

    await expect(dispatcher.execute('read_file', {}, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_INPUT_INVALID' },
    });
    await expect(dispatcher.execute('read_file', { path: 'README.md' }, context)).resolves.toEqual({
      ok: true,
      value: { path: 'README.md' },
    });
  });

  it('waits for explicit approval before running a policy-gated tool', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(tool.execute);
    registry.register({ ...tool, execute });
    let approval: PermissionApprovalOutcome = 'approved';
    const request = vi.fn(async (): Promise<PermissionApprovalOutcome> => approval);
    const dispatcher = new ToolDispatcher(
      registry,
      {
        decide: () => ({
          outcome: 'require_approval',
          reason: 'Read approval is enabled.',
        }),
      },
      observer,
      { request },
    );
    const context = {
      workspaceId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      callId: crypto.randomUUID(),
      signal: new AbortController().signal,
    };

    await expect(
      dispatcher.execute('read_file', { path: 'README.md' }, context),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'read_file' }),
      { path: 'README.md' },
      context,
      'Read approval is enabled.',
    );
    expect(execute).toHaveBeenCalledOnce();

    approval = 'rejected';
    await expect(
      dispatcher.execute('read_file', { path: 'secret.txt' }, context),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_APPROVAL_REJECTED' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
