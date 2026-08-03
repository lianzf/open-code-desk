export * from './debug/debug-events';
export * from './debug/debug-models';
export * from './debug/debug-requests';

export const debugChannels = {
  continue: 'debug:continue',
  decideStart: 'debug:decide-start',
  deleteBreakpoint: 'debug:delete-breakpoint',
  deleteWatch: 'debug:delete-watch',
  evaluate: 'debug:evaluate',
  event: 'debug:event',
  getSettings: 'debug:get-settings',
  listBreakpoints: 'debug:list-breakpoints',
  listHistory: 'debug:list-history',
  listWatches: 'debug:list-watches',
  next: 'debug:next',
  pause: 'debug:pause',
  proposeStart: 'debug:propose-start',
  restart: 'debug:restart',
  runToCursor: 'debug:run-to-cursor',
  saveBreakpoint: 'debug:save-breakpoint',
  saveSettings: 'debug:save-settings',
  saveWatch: 'debug:save-watch',
  scopes: 'debug:scopes',
  stackTrace: 'debug:stack-trace',
  stepIn: 'debug:step-in',
  stepOut: 'debug:step-out',
  stop: 'debug:stop',
  threads: 'debug:threads',
  variables: 'debug:variables',
} as const;
