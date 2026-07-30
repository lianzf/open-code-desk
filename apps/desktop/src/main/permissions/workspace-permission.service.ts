import { realpath, stat } from 'node:fs/promises';

import type { AuditLogService } from '../audit/audit-log.service';
import type { PermissionRuleRepository } from '../commands/permission-rule.repository';
import {
  isPathInside,
  isProtectedSystemPath,
  isSensitiveAbsolutePath,
  normalizeRelativePath,
} from '../filesystem/path-policy';
import type { DirectoryPicker } from '../workspace/directory-picker';
import type { WorkspaceService } from '../workspace/workspace.service';

export class WorkspacePermissionService {
  public constructor(
    private readonly rules: PermissionRuleRepository,
    private readonly workspaces: WorkspaceService,
    private readonly audit?: AuditLogService,
    private readonly externalDirectoryPicker?: DirectoryPicker,
  ) {}

  public async listRules(workspaceId: string) {
    await this.workspaces.getById(workspaceId);
    return this.rules.list(workspaceId);
  }

  public async setReadAutoAllow(workspaceId: string, allowed: boolean) {
    await this.workspaces.getById(workspaceId);
    this.rules.deleteByKind(workspaceId, 'require_read_approval');
    if (!allowed) {
      this.rules.upsert(workspaceId, 'require_read_approval', 'true');
    }
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'permission',
      action: 'read_tools.configure',
      outcome: 'succeeded',
      summary: allowed
        ? 'Workspace read tools may run automatically.'
        : 'Workspace read tools now require approval for every call.',
      metadata: { autoAllow: allowed },
    });
    return this.rules.list(workspaceId);
  }

  public async addBlockedPath(workspaceId: string, requestedPath: string) {
    await this.workspaces.getById(workspaceId);
    const relativePath = normalizeRelativePath(requestedPath);
    if (relativePath === '') {
      throw new Error('不能禁止整个工作区根目录。');
    }
    const rule = this.rules.upsert(workspaceId, 'blocked_path', relativePath);
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'permission',
      action: 'blocked_path.add',
      outcome: 'succeeded',
      summary: `Workspace path ${relativePath} was blocked.`,
      metadata: { ruleId: rule.id, relativePath },
    });
    return rule;
  }

  public async grantExternalDirectory(workspaceId: string) {
    const workspace = await this.workspaces.getById(workspaceId);
    if (this.externalDirectoryPicker === undefined) {
      throw new Error('外部目录选择器不可用。');
    }
    const selected = await this.externalDirectoryPicker.pickDirectory();
    if (selected === null) {
      return null;
    }
    const canonicalPath = await realpath(selected);
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error('只能授权目录。');
    }
    if (isPathInside(workspace.rootPath, canonicalPath)) {
      throw new Error('该目录已位于当前工作区内，无需额外授权。');
    }
    if (isSensitiveAbsolutePath(canonicalPath) || isProtectedSystemPath(canonicalPath)) {
      throw new Error('敏感凭据目录或系统目录不能被授权。');
    }
    const rule = this.rules.upsert(workspaceId, 'external_directory', canonicalPath);
    this.audit?.record({
      workspaceId,
      actor: 'user',
      category: 'permission',
      action: 'external_directory.grant',
      outcome: 'succeeded',
      summary: 'An external directory grant was created by explicit user selection.',
      metadata: { ruleId: rule.id },
    });
    return rule;
  }

  public async deleteRule(workspaceId: string, ruleId: string): Promise<boolean> {
    await this.workspaces.getById(workspaceId);
    const rule = this.rules.list(workspaceId).find((candidate) => candidate.id === ruleId);
    if (rule === undefined) {
      return false;
    }
    const deleted = this.rules.delete(workspaceId, ruleId);
    if (deleted) {
      this.audit?.record({
        workspaceId,
        actor: 'user',
        category: 'permission',
        action: 'permission_rule.delete',
        outcome: 'succeeded',
        summary: `Permission rule ${rule.kind} was deleted.`,
        metadata: { ruleId, kind: rule.kind },
      });
    }
    return deleted;
  }
}
