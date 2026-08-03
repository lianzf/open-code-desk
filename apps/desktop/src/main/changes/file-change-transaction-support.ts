import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FileChange } from '@open-code-desk/domain';

import type { ResolvedWorkspaceFile } from './change-path-resolver';

export interface ApplyPlan {
  readonly change: FileChange;
  readonly source: ResolvedWorkspaceFile | null;
  readonly sourcePath: string;
  readonly destinationPath?: string | undefined;
  readonly proposedContent?: string | undefined;
  temporaryPath?: string | undefined;
  backupPath?: string | undefined;
  executed: boolean;
}

export function transactionPath(targetPath: string, kind: 'tmp' | 'backup'): string {
  return join(dirname(targetPath), `.opencode-${randomUUID()}.${kind}`);
}

export async function writeTemporary(
  targetPath: string,
  content: string,
  mode: number,
): Promise<string> {
  const temporaryPath = transactionPath(targetPath, 'tmp');
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(Buffer.from(content, 'utf8'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
}

export async function installWithoutOverwrite(
  temporaryPath: string,
  targetPath: string,
): Promise<void> {
  await link(temporaryPath, targetPath);
  await unlink(temporaryPath);
}

export function conflictMessage(change: FileChange): string {
  return `${change.filePath} changed after the proposal was created. Reload the workspace and generate a new proposal.`;
}
