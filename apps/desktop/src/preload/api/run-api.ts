import { ipcRenderer } from 'electron';

import {
  compoundRunConfigurationListSchema,
  compoundRunConfigurationSchema,
  compoundRunProposalSchema,
  compoundRunSessionListSchema,
  compoundRunSessionSchema,
  decideProjectTaskStartRequestSchema,
  decideRunStartRequestSchema,
  deleteCompoundRunConfigurationRequestSchema,
  deleteProjectTaskRequestSchema,
  deleteProjectTaskResponseSchema,
  deleteRunConfigurationRequestSchema,
  deleteRunConfigurationResponseSchema,
  detectProjectRequestSchema,
  duplicateRunConfigurationRequestSchema,
  inspectRunPortRequestSchema,
  listCompoundRunSessionsRequestSchema,
  listProjectTaskHistoryRequestSchema,
  listProjectTasksRequestSchema,
  listRunConfigurationsRequestSchema,
  listRunHistoryRequestSchema,
  pendingProjectTaskExecutionSchema,
  pendingRunExecutionSchema,
  projectDetectionSchema,
  projectTaskChannels,
  projectTaskEventSchema,
  projectTaskExecutionIdRequestSchema,
  projectTaskExecutionListSchema,
  projectTaskExecutionSchema,
  projectTaskListSchema,
  projectTaskSchema,
  proposeCompoundRunRequestSchema,
  proposeProjectTaskStartRequestSchema,
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
  saveProjectTaskRequestSchema,
  saveRunConfigurationRequestSchema,
  setDefaultRunConfigurationRequestSchema,
  setDefaultRunConfigurationResponseSchema,
  stopCompoundRunRequestSchema,
  stopRunExecutionRequestSchema,
  terminateRunPortProcessRequestSchema,
  type DesktopApi,
} from '@open-code-desk/ipc-contracts';

export const runApi: DesktopApi['run'] = {
  async detect(input) {
    const request = detectProjectRequestSchema.parse(input);
    return projectDetectionSchema.parse(
      await ipcRenderer.invoke(runChannels.detectProject, request),
    );
  },
  async list(input) {
    const request = listRunConfigurationsRequestSchema.parse(input);
    return runConfigurationListSchema.parse(
      await ipcRenderer.invoke(runChannels.listConfigurations, request),
    );
  },
  async save(input) {
    const request = saveRunConfigurationRequestSchema.parse(input);
    return runConfigurationSchema.parse(
      await ipcRenderer.invoke(runChannels.saveConfiguration, request),
    );
  },
  async delete(input) {
    const request = deleteRunConfigurationRequestSchema.parse(input);
    return deleteRunConfigurationResponseSchema.parse(
      await ipcRenderer.invoke(runChannels.deleteConfiguration, request),
    );
  },
  async duplicate(input) {
    const request = duplicateRunConfigurationRequestSchema.parse(input);
    return runConfigurationSchema.parse(
      await ipcRenderer.invoke(runChannels.duplicateConfiguration, request),
    );
  },
  async setDefault(input) {
    const request = setDefaultRunConfigurationRequestSchema.parse(input);
    return setDefaultRunConfigurationResponseSchema.parse(
      await ipcRenderer.invoke(runChannels.setDefaultConfiguration, request),
    );
  },
  async proposeStart(input) {
    const request = proposeRunStartRequestSchema.parse(input);
    return pendingRunExecutionSchema.parse(
      await ipcRenderer.invoke(runChannels.proposeStart, request),
    );
  },
  async decideStart(input) {
    const request = decideRunStartRequestSchema.parse(input);
    return runExecutionSchema.parse(await ipcRenderer.invoke(runChannels.decideStart, request));
  },
  async stop(input) {
    const request = stopRunExecutionRequestSchema.parse(input);
    return runExecutionSchema.parse(await ipcRenderer.invoke(runChannels.stop, request));
  },
  async restart(input) {
    const request = restartRunExecutionRequestSchema.parse(input);
    return pendingRunExecutionSchema.parse(await ipcRenderer.invoke(runChannels.restart, request));
  },
  async listHistory(input) {
    const request = listRunHistoryRequestSchema.parse(input);
    return runExecutionListSchema.parse(await ipcRenderer.invoke(runChannels.listHistory, request));
  },
  async listCompounds(input) {
    const request = listRunConfigurationsRequestSchema.parse(input);
    return compoundRunConfigurationListSchema.parse(
      await ipcRenderer.invoke(runChannels.listCompoundConfigurations, request),
    );
  },
  async saveCompound(input) {
    const request = saveCompoundRunConfigurationRequestSchema.parse(input);
    return compoundRunConfigurationSchema.parse(
      await ipcRenderer.invoke(runChannels.saveCompoundConfiguration, request),
    );
  },
  async deleteCompound(input) {
    const request = deleteCompoundRunConfigurationRequestSchema.parse(input);
    return deleteRunConfigurationResponseSchema.parse(
      await ipcRenderer.invoke(runChannels.deleteCompoundConfiguration, request),
    );
  },
  async listCompoundSessions(input) {
    const request = listCompoundRunSessionsRequestSchema.parse(input);
    return compoundRunSessionListSchema.parse(
      await ipcRenderer.invoke(runChannels.listCompoundSessions, request),
    );
  },
  async proposeCompoundStart(input) {
    const request = proposeCompoundRunRequestSchema.parse(input);
    return compoundRunProposalSchema.parse(
      await ipcRenderer.invoke(runChannels.proposeCompoundStart, request),
    );
  },
  async stopCompound(input) {
    const request = stopCompoundRunRequestSchema.parse(input);
    return compoundRunSessionSchema.parse(
      await ipcRenderer.invoke(runChannels.stopCompound, request),
    );
  },
  async inspectPort(input) {
    const request = inspectRunPortRequestSchema.parse(input);
    return runPortInspectionSchema.parse(
      await ipcRenderer.invoke(runChannels.inspectPort, request),
    );
  },
  async terminatePortProcess(input) {
    const request = terminateRunPortProcessRequestSchema.parse(input);
    return runPortInspectionSchema.parse(
      await ipcRenderer.invoke(runChannels.terminatePortProcess, request),
    );
  },
  onEvent(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(runEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(runChannels.event, wrappedListener);
    return () => ipcRenderer.removeListener(runChannels.event, wrappedListener);
  },
};

export const projectTasksApi: DesktopApi['projectTasks'] = {
  async list(input) {
    const request = listProjectTasksRequestSchema.parse(input);
    return projectTaskListSchema.parse(await ipcRenderer.invoke(projectTaskChannels.list, request));
  },
  async save(input) {
    const request = saveProjectTaskRequestSchema.parse(input);
    return projectTaskSchema.parse(await ipcRenderer.invoke(projectTaskChannels.save, request));
  },
  async delete(input) {
    const request = deleteProjectTaskRequestSchema.parse(input);
    return deleteProjectTaskResponseSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.delete, request),
    );
  },
  async proposeStart(input) {
    const request = proposeProjectTaskStartRequestSchema.parse(input);
    return pendingProjectTaskExecutionSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.proposeStart, request),
    );
  },
  async decideStart(input) {
    const request = decideProjectTaskStartRequestSchema.parse(input);
    return projectTaskExecutionSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.decideStart, request),
    );
  },
  async stop(input) {
    const request = projectTaskExecutionIdRequestSchema.parse(input);
    return projectTaskExecutionSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.stop, request),
    );
  },
  async restart(input) {
    const request = projectTaskExecutionIdRequestSchema.parse(input);
    return pendingProjectTaskExecutionSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.restart, request),
    );
  },
  async listHistory(input) {
    const request = listProjectTaskHistoryRequestSchema.parse(input);
    return projectTaskExecutionListSchema.parse(
      await ipcRenderer.invoke(projectTaskChannels.listHistory, request),
    );
  },
  onEvent(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(projectTaskEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(projectTaskChannels.event, wrappedListener);
    return () => ipcRenderer.removeListener(projectTaskChannels.event, wrappedListener);
  },
};
