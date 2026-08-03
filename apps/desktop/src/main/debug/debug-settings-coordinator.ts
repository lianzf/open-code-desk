import type { DebugSettings } from '@open-code-desk/domain';
import type {
  GetDebugSettingsRequest,
  SaveDebugSettingsRequest,
} from '@open-code-desk/ipc-contracts';

import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterSession } from './debug-adapter';
import type { DebugSettingsRepository } from './debug-settings.repository';

export interface DebugSettingsCoordinatorOptions {
  readonly repository: DebugSettingsRepository;
  readonly workspaces: WorkspaceService;
  readonly activeAdapter: (workspaceId: string) => DebugAdapterSession | undefined;
}

export class DebugSettingsCoordinator {
  public constructor(private readonly options: DebugSettingsCoordinatorOptions) {}

  public current(workspaceId: string): DebugSettings {
    return this.options.repository.get(workspaceId);
  }

  public async get(input: GetDebugSettingsRequest): Promise<DebugSettings> {
    await this.options.workspaces.getById(input.workspaceId);
    return this.current(input.workspaceId);
  }

  public async save(input: SaveDebugSettingsRequest): Promise<DebugSettings> {
    await this.options.workspaces.getById(input.workspaceId);
    const policy = {
      exceptionPauseMode: input.exceptionPauseMode,
      exceptionBreakTypes: input.exceptionBreakTypes,
      exceptionIgnoreTypes: input.exceptionIgnoreTypes,
    };
    await this.options.activeAdapter(input.workspaceId)?.setExceptionBreakpoints(policy);
    return this.options.repository.save(input.workspaceId, policy);
  }
}
