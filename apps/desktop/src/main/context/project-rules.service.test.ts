import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { ProjectRulesService } from './project-rules.service';

describe('ProjectRulesService', () => {
  it('loads only fixed workspace rule paths and ignores unavailable candidates', async () => {
    const readFile = vi.fn<WorkspaceFileService['readFile']>(async (_workspaceId, path) => {
      if (path !== 'AGENTS.md') {
        throw new Error('not found');
      }
      return {
        relativePath: path,
        content: 'Use strict TypeScript.',
        contentHash: 'a'.repeat(64),
        size: 22,
        modifiedAt: new Date(0).toISOString(),
        language: 'markdown',
      };
    });
    const service = new ProjectRulesService({ readFile });

    await expect(service.load(crypto.randomUUID(), new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        id: 'project-rule:AGENTS.md',
        type: 'rules',
        title: 'AGENTS.md',
        content: 'Use strict TypeScript.',
        priority: 1_000,
      }),
    ]);
    expect(readFile).toHaveBeenCalledTimes(5);
    expect(readFile.mock.calls.map((call) => call[1])).toEqual([
      'AGENTS.md',
      'CODEX.md',
      'CLAUDE.md',
      '.cursorrules',
      '.github/copilot-instructions.md',
    ]);
  });

  it('stops immediately when the Agent task is cancelled', async () => {
    const readFile = vi.fn<WorkspaceFileService['readFile']>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ProjectRulesService({ readFile }).load(crypto.randomUUID(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(readFile).not.toHaveBeenCalled();
  });
});
