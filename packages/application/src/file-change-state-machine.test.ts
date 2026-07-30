import { describe, expect, it } from 'vitest';

import {
  assertFileChangeSetTransition,
  assertFileChangeTransition,
  FileChangeTransitionError,
} from './file-change-state-machine';

describe('file change state transitions', () => {
  it('allows review, apply, and rollback transitions', () => {
    expect(() => assertFileChangeTransition('pending', 'approved')).not.toThrow();
    expect(() => assertFileChangeTransition('approved', 'applied')).not.toThrow();
    expect(() => assertFileChangeTransition('applied', 'rolled_back')).not.toThrow();
    expect(() => assertFileChangeSetTransition('pending_review', 'ready_to_apply')).not.toThrow();
    expect(() => assertFileChangeSetTransition('ready_to_apply', 'applying')).not.toThrow();
    expect(() => assertFileChangeSetTransition('applying', 'applied')).not.toThrow();
    expect(() => assertFileChangeSetTransition('applied', 'rolling_back')).not.toThrow();
  });

  it('rejects replay and terminal-state mutations', () => {
    expect(() => assertFileChangeTransition('applied', 'approved')).toThrow(
      FileChangeTransitionError,
    );
    expect(() => assertFileChangeSetTransition('rolled_back', 'applying')).toThrow(
      FileChangeTransitionError,
    );
  });
});
