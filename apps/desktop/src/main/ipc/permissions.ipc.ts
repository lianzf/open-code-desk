import { ipcMain } from 'electron';
import {
  addBlockedPathRequestSchema,
  decideToolApprovalRequestSchema,
  deletePermissionRuleRequestSchema,
  deletePermissionRuleResponseSchema,
  grantExternalDirectoryRequestSchema,
  nullablePermissionRuleSchema,
  permissionActionResponseSchema,
  permissionChannels,
  permissionRuleListSchema,
  permissionRuleSchema,
  setReadAutoAllowRequestSchema,
  workspaceRulesRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { ToolApprovalService } from '../agent/tool-approval.service';
import type { WorkspacePermissionService } from '../permissions/workspace-permission.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerPermissionsIpc(
  options: TrustedRendererOptions,
  service: WorkspacePermissionService,
  approvals: ToolApprovalService,
): void {
  ipcMain.handle(permissionChannels.addBlockedPath, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = addBlockedPathRequestSchema.parse(untrustedInput);
    return permissionRuleSchema.parse(
      await service.addBlockedPath(input.workspaceId, input.relativePath),
    );
  });

  ipcMain.handle(permissionChannels.decideTool, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = decideToolApprovalRequestSchema.parse(untrustedInput);
    return permissionActionResponseSchema.parse({
      accepted: approvals.decide(input),
    });
  });

  ipcMain.handle(permissionChannels.deleteRule, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deletePermissionRuleRequestSchema.parse(untrustedInput);
    return deletePermissionRuleResponseSchema.parse({
      deleted: await service.deleteRule(input.workspaceId, input.ruleId),
    });
  });

  ipcMain.handle(
    permissionChannels.grantExternalDirectory,
    async (event, untrustedInput: unknown) => {
      assertTrustedIpcEvent(event, options);
      const input = grantExternalDirectoryRequestSchema.parse(untrustedInput);
      return nullablePermissionRuleSchema.parse(
        await service.grantExternalDirectory(input.workspaceId),
      );
    },
  );

  ipcMain.handle(permissionChannels.listRules, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = workspaceRulesRequestSchema.parse(untrustedInput);
    return permissionRuleListSchema.parse(await service.listRules(input.workspaceId));
  });

  ipcMain.handle(permissionChannels.setReadAutoAllow, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = setReadAutoAllowRequestSchema.parse(untrustedInput);
    return permissionRuleListSchema.parse(
      await service.setReadAutoAllow(input.workspaceId, input.allowed),
    );
  });
}

export function unregisterPermissionsIpc(): void {
  Object.values(permissionChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
