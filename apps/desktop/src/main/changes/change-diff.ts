import { applyPatch as applyUnifiedPatch, createTwoFilesPatch } from 'diff';

import type { FileChangeOperation } from '@open-code-desk/domain';

export function createChangeDiff(
  operation: FileChangeOperation,
  filePath: string,
  originalContent: string,
  proposedContent: string,
  destinationPath?: string,
): string {
  const oldPath = operation === 'create' ? '/dev/null' : `a/${filePath}`;
  const newPath =
    operation === 'delete'
      ? '/dev/null'
      : `b/${operation === 'rename' ? (destinationPath ?? filePath) : filePath}`;
  const patch = createTwoFilesPatch(
    oldPath,
    newPath,
    originalContent,
    proposedContent,
    'workspace baseline',
    'proposed change',
    { context: 3 },
  );
  if (operation !== 'rename') {
    return patch;
  }
  return `rename from ${filePath}\nrename to ${destinationPath ?? filePath}\n${patch}`;
}

export function applyChangePatch(originalContent: string, patch: string): string {
  const result = applyUnifiedPatch(originalContent, patch);
  if (result === false) {
    throw new Error('The proposed patch does not apply cleanly to the workspace baseline.');
  }
  return result;
}
