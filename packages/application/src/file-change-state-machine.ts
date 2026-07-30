import type { FileChangeSetStatus, FileChangeStatus } from '@open-code-desk/domain';

const changeTransitions: Readonly<Record<FileChangeStatus, ReadonlySet<FileChangeStatus>>> = {
  pending: new Set(['approved', 'rejected']),
  approved: new Set(['pending', 'rejected', 'applied', 'failed']),
  rejected: new Set(['pending']),
  applied: new Set(['rolled_back', 'failed']),
  failed: new Set(['pending', 'approved', 'rolled_back']),
  rolled_back: new Set(),
};

const setTransitions: Readonly<Record<FileChangeSetStatus, ReadonlySet<FileChangeSetStatus>>> = {
  pending_review: new Set(['ready_to_apply', 'cancelled']),
  ready_to_apply: new Set(['pending_review', 'applying', 'cancelled']),
  applying: new Set(['applied', 'failed', 'rolled_back']),
  applied: new Set(['rolling_back']),
  failed: new Set(['pending_review', 'ready_to_apply', 'rolling_back', 'rolled_back']),
  rolling_back: new Set(['rolled_back', 'failed']),
  rolled_back: new Set(),
  cancelled: new Set(),
};

export class FileChangeTransitionError extends Error {
  public constructor(
    readonly aggregate: 'change' | 'change_set',
    readonly from: FileChangeStatus | FileChangeSetStatus,
    readonly to: FileChangeStatus | FileChangeSetStatus,
  ) {
    super(`Invalid ${aggregate} state transition: ${from} -> ${to}.`);
    this.name = 'FileChangeTransitionError';
  }
}

export function assertFileChangeTransition(from: FileChangeStatus, to: FileChangeStatus): void {
  if (!changeTransitions[from].has(to)) {
    throw new FileChangeTransitionError('change', from, to);
  }
}

export function assertFileChangeSetTransition(
  from: FileChangeSetStatus,
  to: FileChangeSetStatus,
): void {
  if (!setTransitions[from].has(to)) {
    throw new FileChangeTransitionError('change_set', from, to);
  }
}
