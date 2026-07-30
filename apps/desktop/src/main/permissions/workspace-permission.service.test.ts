import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentTool } from '@open-code-desk/tool-core';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PermissionRuleRepository } from '../commands/permission-rule.repository';
import { ChangePathResolver } from '../changes/change-path-resolver';
import { createAppDatabase, type AppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { ProposalAwarePermissionPolicy } from '../tools/file-proposal-tools';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { ExternalDirectoryService } from './external-directory.service';
import { WorkspacePathPolicy } from './workspace-path-policy';
import { WorkspacePermissionService } from './workspace-permission.service';

class StaticDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly path: string) {}

  public async pickDirectory(): Promise<string> {
    return this.path;
  }
}

describe('WorkspacePermissionService', () => {
  let database: AppDatabase;
  let directory: string;

  beforeEach(async () => {
    database = createAppDatabase(':memory:');
    directory = await mkdtemp(join(tmpdir(), 'open-code-desk-permissions-'));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists the read auto-allow preference and changes policy decisions', async () => {
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new StaticDirectoryPicker(directory),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Expected a test workspace.');
    }
    const rules = new PermissionRuleRepository(database);
    const service = new WorkspacePermissionService(rules, workspaces);
    const policy = new ProposalAwarePermissionPolicy(rules);
    const tool: AgentTool = {
      name: 'read_file',
      description: 'Read one file',
      inputSchema: z.object({ path: z.string() }),
      permissionLevel: 'read',
      async execute() {
        return {};
      },
    };
    const context = {
      workspaceId: workspace.id,
      conversationId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      callId: crypto.randomUUID(),
      signal: new AbortController().signal,
    };

    expect(policy.decide(tool, context).outcome).toBe('allow');
    await service.setReadAutoAllow(workspace.id, false);
    expect(await service.listRules(workspace.id)).toMatchObject([
      { kind: 'require_read_approval', value: 'true' },
    ]);
    expect(policy.decide(tool, context).outcome).toBe('require_approval');

    await service.setReadAutoAllow(workspace.id, true);
    expect(await service.listRules(workspace.id)).toEqual([]);
    expect(policy.decide(tool, context).outcome).toBe('allow');
    expect(policy.decide({ ...tool, name: 'read_external_file' }, context).outcome).toBe(
      'require_approval',
    );
  });

  it('blocks configured workspace paths for direct reads and change proposals', async () => {
    await mkdir(join(directory, 'private'));
    await writeFile(join(directory, 'private', 'secret.ts'), 'export const secret = 1;\n');
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new StaticDirectoryPicker(directory),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Expected a test workspace.');
    }
    const rules = new PermissionRuleRepository(database);
    const service = new WorkspacePermissionService(rules, workspaces);
    await service.addBlockedPath(workspace.id, 'private');
    const pathPolicy = new WorkspacePathPolicy(rules);
    const files = new WorkspaceFileService(workspaces, undefined, pathPolicy);
    const changes = new ChangePathResolver(workspaces, pathPolicy);

    await expect(files.readFile(workspace.id, 'private/secret.ts')).rejects.toThrow(
      '权限规则禁止访问',
    );
    await expect(changes.existing(workspace.id, 'private/secret.ts')).rejects.toThrow(
      '权限规则禁止访问',
    );
    await expect(files.listDirectory(workspace.id, '')).resolves.toEqual([
      expect.objectContaining({
        relativePath: 'private',
        restricted: true,
      }),
    ]);
  });

  it('requires an explicit directory selection grant and still denies sensitive files', async () => {
    const external = await mkdtemp(join(tmpdir(), 'open-code-desk-external-'));
    try {
      await writeFile(join(external, 'notes.txt'), 'safe external context\n');
      await writeFile(join(external, '.env'), 'TOKEN=never-read\n');
      const workspaces = new WorkspaceService(
        new WorkspaceRepository(database),
        new StaticDirectoryPicker(directory),
      );
      const workspace = await workspaces.openFromDialog();
      if (workspace === null) {
        throw new Error('Expected a test workspace.');
      }
      const rules = new PermissionRuleRepository(database);
      const service = new WorkspacePermissionService(
        rules,
        workspaces,
        undefined,
        new StaticDirectoryPicker(external),
      );
      const grant = await service.grantExternalDirectory(workspace.id);
      if (grant === null) {
        throw new Error('Expected an external directory grant.');
      }
      const directories = new ExternalDirectoryService(rules, workspaces);

      await expect(directories.listGrants(workspace.id)).resolves.toEqual([
        { id: grant.id, name: expect.any(String) },
      ]);
      await expect(
        directories.readFile(workspace.id, grant.id, 'notes.txt'),
      ).resolves.toMatchObject({
        content: 'safe external context\n',
      });
      await expect(directories.readFile(workspace.id, grant.id, '.env')).rejects.toThrow(
        '敏感路径策略保护',
      );
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});
