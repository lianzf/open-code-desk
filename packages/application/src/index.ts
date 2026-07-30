export interface ApplicationClock {
  now(): Date;
}

export interface ApplicationInfo {
  readonly name: string;
  readonly version: string;
}

export * from './context-builder';
export * from './agent-state-machine';
export * from './file-change-state-machine';
