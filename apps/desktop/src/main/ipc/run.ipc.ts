import { BrowserWindow, ipcMain } from 'electron';
import {
  compoundRunConfigurationListSchema,
  compoundRunConfigurationSchema,
  compoundRunProposalSchema,
  compoundRunSessionListSchema,
  compoundRunSessionSchema,
  decideRunStartRequestSchema,
  deleteCompoundRunConfigurationRequestSchema,
  deleteRunConfigurationRequestSchema,
  deleteRunConfigurationResponseSchema,
  duplicateRunConfigurationRequestSchema,
  inspectRunPortRequestSchema,
  listCompoundRunSessionsRequestSchema,
  detectProjectRequestSchema,
  listRunHistoryRequestSchema,
  listRunConfigurationsRequestSchema,
  pendingRunExecutionSchema,
  projectDetectionSchema,
  proposeCompoundRunRequestSchema,
  proposeRunStartRequestSchema,
  restartRunExecutionRequestSchema,
  runChannels,
  runConfigurationListSchema,
  runConfigurationSchema,
  runEventSchema,
  runExecutionListSchema,
  runExecutionSchema,
  runPortInspectionSchema,
  saveCompoundRunConfigurationRequestSchema,
  saveRunConfigurationRequestSchema,
  setDefaultRunConfigurationRequestSchema,
  setDefaultRunConfigurationResponseSchema,
  stopRunExecutionRequestSchema,
  stopCompoundRunRequestSchema,
  terminateRunPortProcessRequestSchema,
} from '@open-code-desk/ipc-contracts';

import { detectProject } from '../run/project-detector';
import type { CompoundRunService } from '../run/compound-run.service';
import type { RunConfigurationService } from '../run/run-configuration.service';
import type { RunExecutionService } from '../run/run-execution.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

let unsubscribeRunEvents: (() => void) | null = null;

export function registerRunIpc(
  options: TrustedRendererOptions,
  workspaceService: WorkspaceService,
  configurationService: RunConfigurationService,
  executionService: RunExecutionService,
  compoundService: CompoundRunService,
): void {
  unsubscribeRunEvents?.();
  unsubscribeRunEvents = executionService.subscribe((event) => {
    const parsed = runEventSchema.parse(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(runChannels.event, parsed);
      }
    }
  });
  ipcMain.handle(runChannels.detectProject, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = detectProjectRequestSchema.parse(untrustedInput);
    const workspace = await workspaceService.getById(input.workspaceId);
    return projectDetectionSchema.parse(
      await detectProject(workspace.id, workspace.rootPath, input.locale),
    );
  });

  ipcMain.handle(runChannels.listConfigurations, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listRunConfigurationsRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return runConfigurationListSchema.parse(configurationService.list(input.workspaceId));
  });

  ipcMain.handle(runChannels.listCompoundConfigurations, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listRunConfigurationsRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return compoundRunConfigurationListSchema.parse(compoundService.list(input.workspaceId));
  });

  ipcMain.handle(runChannels.saveCompoundConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = saveCompoundRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return compoundRunConfigurationSchema.parse(compoundService.save(input));
  });

  ipcMain.handle(
    runChannels.deleteCompoundConfiguration,
    async (event, untrustedInput: unknown) => {
      assertTrustedIpcEvent(event, options);
      const input = deleteCompoundRunConfigurationRequestSchema.parse(untrustedInput);
      await workspaceService.getById(input.workspaceId);
      return deleteRunConfigurationResponseSchema.parse({
        deleted: compoundService.delete(input),
      });
    },
  );

  ipcMain.handle(runChannels.listCompoundSessions, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listCompoundRunSessionsRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return compoundRunSessionListSchema.parse(compoundService.listSessions(input.workspaceId));
  });

  ipcMain.handle(runChannels.proposeCompoundStart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = proposeCompoundRunRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return compoundRunProposalSchema.parse(await compoundService.proposeStart(input));
  });

  ipcMain.handle(runChannels.stopCompound, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = stopCompoundRunRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return compoundRunSessionSchema.parse(await compoundService.stopAll(input));
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

  ipcMain.handle(runChannels.duplicateConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = duplicateRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return runConfigurationSchema.parse(await configurationService.duplicate(input));
  });

  ipcMain.handle(runChannels.setDefaultConfiguration, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = setDefaultRunConfigurationRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return setDefaultRunConfigurationResponseSchema.parse(configurationService.setDefault(input));
  });

  ipcMain.handle(runChannels.proposeStart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = proposeRunStartRequestSchema.parse(untrustedInput);
    return pendingRunExecutionSchema.parse(await executionService.proposeStart(input));
  });

  ipcMain.handle(runChannels.decideStart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = decideRunStartRequestSchema.parse(untrustedInput);
    return runExecutionSchema.parse(await executionService.decideStart(input));
  });

  ipcMain.handle(runChannels.stop, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = stopRunExecutionRequestSchema.parse(untrustedInput);
    return runExecutionSchema.parse(await executionService.stop(input));
  });

  ipcMain.handle(runChannels.restart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = restartRunExecutionRequestSchema.parse(untrustedInput);
    return pendingRunExecutionSchema.parse(await executionService.restart(input));
  });

  ipcMain.handle(runChannels.listHistory, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listRunHistoryRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return runExecutionListSchema.parse(executionService.listHistory(input));
  });

  ipcMain.handle(runChannels.inspectPort, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = inspectRunPortRequestSchema.parse(untrustedInput);
    return runPortInspectionSchema.parse(await executionService.inspectPort(input));
  });

  ipcMain.handle(runChannels.terminatePortProcess, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = terminateRunPortProcessRequestSchema.parse(untrustedInput);
    return runPortInspectionSchema.parse(await executionService.terminatePortProcess(input));
  });
}

export function unregisterRunIpc(): void {
  unsubscribeRunEvents?.();
  unsubscribeRunEvents = null;
  Object.values(runChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
