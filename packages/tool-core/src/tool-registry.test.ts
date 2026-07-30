import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  DefaultPermissionPolicy,
  ToolDispatcher,
  ToolRegistry,
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
});
