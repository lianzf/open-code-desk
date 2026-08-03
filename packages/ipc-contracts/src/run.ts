export {
  debugAttachConfigurationSchema,
  projectTypeSchema,
  runConsoleSchema,
  runEnvironmentVariableInputSchema,
  runEnvironmentVariableSchema,
  type DebugAttachConfiguration,
  type ProjectType,
  type RunConsole,
  type RunEnvironmentVariable,
  type RunEnvironmentVariableInput,
} from './run/run-common';
export * from './run/run-compound';
export * from './run/run-configuration';
export * from './run/run-execution';

export const runChannels = {
  deleteCompoundConfiguration: 'run:delete-compound-configuration',
  decideStart: 'run:decide-start',
  deleteConfiguration: 'run:delete-configuration',
  duplicateConfiguration: 'run:duplicate-configuration',
  detectProject: 'run:detect-project',
  event: 'run:event',
  listConfigurations: 'run:list-configurations',
  listHistory: 'run:list-history',
  inspectPort: 'run:inspect-port',
  listCompoundConfigurations: 'run:list-compound-configurations',
  listCompoundSessions: 'run:list-compound-sessions',
  proposeStart: 'run:propose-start',
  proposeCompoundStart: 'run:propose-compound-start',
  restart: 'run:restart',
  saveConfiguration: 'run:save-configuration',
  saveCompoundConfiguration: 'run:save-compound-configuration',
  setDefaultConfiguration: 'run:set-default-configuration',
  stop: 'run:stop',
  stopCompound: 'run:stop-compound',
  terminatePortProcess: 'run:terminate-port-process',
} as const;
