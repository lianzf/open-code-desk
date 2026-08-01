import type { DebugEvent } from '@open-code-desk/domain';

import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterEvent, DebugAdapterSession } from './debug-adapter';
import { DebugBreakpointCoordinator } from './debug-breakpoint-coordinator';
import type { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugSettingsCoordinator } from './debug-settings-coordinator';
import type { DebugSettingsRepository } from './debug-settings.repository';
import { DebugWatchCoordinator } from './debug-watch-coordinator';
import type { DebugWatchRepository } from './debug-watch.repository';

export interface DebugConfigurationCoordinatorOptions {
  readonly breakpoints: DebugBreakpointRepository;
  readonly settings: DebugSettingsRepository;
  readonly watches: DebugWatchRepository;
  readonly workspaces: WorkspaceService;
  readonly activeAdapter: (workspaceId: string) => DebugAdapterSession | undefined;
  readonly emit: (event: DebugEvent) => void;
}

/** Keeps workspace-scoped debugging configuration separate from session lifecycle. */
export class DebugConfigurationCoordinator {
  public readonly breakpoints: DebugBreakpointCoordinator;
  public readonly settings: DebugSettingsCoordinator;
  public readonly watches: DebugWatchCoordinator;

  public constructor(options: DebugConfigurationCoordinatorOptions) {
    this.breakpoints = new DebugBreakpointCoordinator({
      repository: options.breakpoints,
      workspaces: options.workspaces,
      activeAdapter: options.activeAdapter,
      emit: options.emit,
    });
    this.settings = new DebugSettingsCoordinator({
      repository: options.settings,
      workspaces: options.workspaces,
      activeAdapter: options.activeAdapter,
    });
    this.watches = new DebugWatchCoordinator(options.watches);
  }

  public updateBreakpointFromAdapter(
    workspaceId: string,
    event: Extract<DebugAdapterEvent, { type: 'breakpoint' }>,
  ): Promise<void> {
    return this.breakpoints.updateFromAdapter(workspaceId, event);
  }
}
