import { BrowserWindow, ipcMain } from 'electron';
import {
  decideProjectTaskStartRequestSchema,
  deleteProjectTaskRequestSchema,
  deleteProjectTaskResponseSchema,
  listProjectTaskHistoryRequestSchema,
  listProjectTasksRequestSchema,
  pendingProjectTaskExecutionSchema,
  projectTaskChannels,
  projectTaskEventSchema,
  projectTaskExecutionIdRequestSchema,
  projectTaskExecutionListSchema,
  projectTaskExecutionSchema,
  projectTaskListSchema,
  projectTaskSchema,
  proposeProjectTaskStartRequestSchema,
  saveProjectTaskRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import type { ProjectTaskService } from '../project-tasks/project-task.service';
import type { WorkspaceService } from '../workspace/workspace.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

let unsubscribeProjectTaskEvents: (() => void) | null = null;

export function registerProjectTasksIpc(
  options: TrustedRendererOptions,
  workspaceService: WorkspaceService,
  taskService: ProjectTaskService,
  executionService: ProjectTaskExecutionService,
): void {
  unsubscribeProjectTaskEvents?.();
  unsubscribeProjectTaskEvents = executionService.subscribe((event) => {
    const parsed = projectTaskEventSchema.parse(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(projectTaskChannels.event, parsed);
      }
    }
  });

  ipcMain.handle(projectTaskChannels.list, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listProjectTasksRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return projectTaskListSchema.parse(taskService.list(input.workspaceId));
  });

  ipcMain.handle(projectTaskChannels.save, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = saveProjectTaskRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return projectTaskSchema.parse(await taskService.save(input));
  });

  ipcMain.handle(projectTaskChannels.delete, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deleteProjectTaskRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return deleteProjectTaskResponseSchema.parse({ deleted: await taskService.delete(input) });
  });

  ipcMain.handle(projectTaskChannels.proposeStart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = proposeProjectTaskStartRequestSchema.parse(untrustedInput);
    return pendingProjectTaskExecutionSchema.parse(await executionService.proposeStart(input));
  });

  ipcMain.handle(projectTaskChannels.decideStart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = decideProjectTaskStartRequestSchema.parse(untrustedInput);
    return projectTaskExecutionSchema.parse(await executionService.decideStart(input));
  });

  ipcMain.handle(projectTaskChannels.stop, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = projectTaskExecutionIdRequestSchema.parse(untrustedInput);
    return projectTaskExecutionSchema.parse(await executionService.stop(input));
  });

  ipcMain.handle(projectTaskChannels.restart, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = projectTaskExecutionIdRequestSchema.parse(untrustedInput);
    return pendingProjectTaskExecutionSchema.parse(await executionService.restart(input));
  });

  ipcMain.handle(projectTaskChannels.listHistory, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listProjectTaskHistoryRequestSchema.parse(untrustedInput);
    await workspaceService.getById(input.workspaceId);
    return projectTaskExecutionListSchema.parse(executionService.listHistory(input));
  });
}

export function unregisterProjectTasksIpc(): void {
  unsubscribeProjectTaskEvents?.();
  unsubscribeProjectTaskEvents = null;
  Object.values(projectTaskChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
