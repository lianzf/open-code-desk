import type { PermissionRuleRepository } from '../commands/permission-rule.repository';
import { normalizeRelativePath } from '../filesystem/path-policy';

export class WorkspacePathPolicy {
  public constructor(private readonly rules: PermissionRuleRepository) {}

  public isBlocked(workspaceId: string, requestedPath: string): boolean {
    const relativePath = normalizeRelativePath(requestedPath);
    return this.rules
      .list(workspaceId)
      .filter((rule) => rule.kind === 'blocked_path')
      .some((rule) => relativePath === rule.value || relativePath.startsWith(`${rule.value}/`));
  }

  public assertAllowed(workspaceId: string, requestedPath: string): void {
    if (this.isBlocked(workspaceId, requestedPath)) {
      throw new Error('该路径已被工作区权限规则禁止访问。');
    }
  }
}
