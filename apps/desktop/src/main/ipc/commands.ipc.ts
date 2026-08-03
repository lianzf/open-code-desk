import { ipcMain } from 'electron';
import {
  commandActionResponseSchema,
  commandChannels,
  commandExecutionListSchema,
  commandExecutionSchema,
  commandIdRequestSchema,
  decideCommandRequestSchema,
  deletePermissionRuleRequestSchema,
  deletePermissionRuleResponseSchema,
  listCommandsRequestSchema,
  permissionRuleListSchema,
  permissionRuleSchema,
  setNetworkAccessRequestSchema,
  upsertExecutableRuleRequestSchema,
  workspaceRulesRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { CommandService } from '../commands/command.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerCommandsIpc(
  options: TrustedRendererOptions,
  service: CommandService,
): void {
  ipcMain.handle(commandChannels.listForConversation, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listCommandsRequestSchema.parse(untrustedInput);
    return commandExecutionListSchema.parse(service.listForConversation(input.conversationId));
  });

  ipcMain.handle(commandChannels.decide, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = decideCommandRequestSchema.parse(untrustedInput);
    return commandExecutionSchema.parse(service.decide(input));
  });

  ipcMain.handle(commandChannels.cancel, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = commandIdRequestSchema.parse(untrustedInput);
    return commandActionResponseSchema.parse({
      accepted: service.cancel(input.commandId),
    });
  });

  ipcMain.handle(commandChannels.listRules, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = workspaceRulesRequestSchema.parse(untrustedInput);
    return permissionRuleListSchema.parse(service.listRules(input.workspaceId));
  });

  ipcMain.handle(commandChannels.deleteRule, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deletePermissionRuleRequestSchema.parse(untrustedInput);
    return deletePermissionRuleResponseSchema.parse({
      deleted: service.deleteRule(input.workspaceId, input.ruleId),
    });
  });

  ipcMain.handle(commandChannels.setNetworkAccess, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = setNetworkAccessRequestSchema.parse(untrustedInput);
    return permissionRuleListSchema.parse(
      service.setNetworkAccess(input.workspaceId, input.allowed),
    );
  });

  ipcMain.handle(commandChannels.upsertExecutableRule, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = upsertExecutableRuleRequestSchema.parse(untrustedInput);
    return permissionRuleSchema.parse(
      await service.upsertExecutableRule(
        input.workspaceId,
        input.kind,
        input.executable,
        input.cwd,
        input.args,
      ),
    );
  });
}

export function unregisterCommandsIpc(): void {
  Object.values(commandChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
