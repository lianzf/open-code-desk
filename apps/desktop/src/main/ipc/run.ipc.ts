import { ipcMain } from 'electron';
import {
  deleteRunConfigurationRequestSchema,
  deleteRunConfigurationResponseSchema,
  detectProjectRequestSchema,
  listRunConfigurationsRequestSchema,
  projectDetectionSchema,
  runChannels,
  runConfigurationListSchema,
  runConfigurationSchema,
  saveRunConfigurationRequestSchema,
  setDefaultRunConfigurationRequestSchema,
  setDefaultRunConfigurationResponseSchema,
} from '@open-code-desk/ipc-contracts';

import { detectProject } from '../run/project-detector';
import type { RunConfigurationService } from '../run/run-configuration.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerRunIpc(
  options: TrustedRendererOptions,
  workspaceService: WorkspaceService,
  configurationService: RunConfigurationService,
): void {
  ipcMain.handle(runChannels.detectProject, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = detectProjectRequestSchema.parse(untrustedInput);
    const workspace = await workspaceService.getById(input.workspaceId);
    return projectDetectionSchema.parse(await detectProject(workspace.id, workspace.rootPath));
  });

  ipcMain.handle(runChannels.listConfigurations, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listRunConfigurationsRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return runConfigurationListSchema.parse(configurationService.list(input.workspaceId));
  });

  ipcMain.handle(runChannels.saveConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = saveRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return runConfigurationSchema.parse(await configurationService.save(input));
  });

  ipcMain.handle(runChannels.deleteConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deleteRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return deleteRunConfigurationResponseSchema.parse({
      deleted: await configurationService.delete(input),
    });
  });

  ipcMain.handle(runChannels.setDefaultConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = setDefaultRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return setDefaultRunConfigurationResponseSchema.parse(configurationService.setDefault(input));
  });
}

export function unregisterRunIpc(): void {
  Object.values(runChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
