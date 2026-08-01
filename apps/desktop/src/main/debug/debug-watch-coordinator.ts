import type { DebugWatchExpression } from '@open-code-desk/domain';
import type {
  DeleteDebugWatchRequest,
  ListDebugWatchesRequest,
  SaveDebugWatchRequest,
} from '@open-code-desk/ipc-contracts';

import type { DebugWatchRepository } from './debug-watch.repository';

export class DebugWatchCoordinator {
  public constructor(private readonly repository: DebugWatchRepository) {}

  public list(input: ListDebugWatchesRequest): ReadonlyArray<DebugWatchExpression> {
    return this.repository.list(input.workspaceId);
  }

  public save(input: SaveDebugWatchRequest): DebugWatchExpression {
    return this.repository.save({
      workspaceId: input.workspaceId,
      expression: input.expression,
      ...(input.id === undefined ? {} : { id: input.id }),
    });
  }

  public delete(input: DeleteDebugWatchRequest): boolean {
    return this.repository.delete(input.workspaceId, input.watchId);
  }
}
