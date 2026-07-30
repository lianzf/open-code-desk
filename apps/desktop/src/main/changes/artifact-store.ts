import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const maximumArtifactBytes = 2_000_000;

export function sha256(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Stores review and rollback payloads outside the workspace. Filenames are
 * content digests, never user-controlled paths.
 */
export class ChangeArtifactStore {
  public constructor(private readonly rootPath: string) {}

  public async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
  }

  public async putText(content: string): Promise<string> {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.byteLength > maximumArtifactBytes) {
      throw new Error('Proposed file content exceeds the 2 MB review limit.');
    }
    await this.initialize();
    const reference = sha256(bytes);
    const targetPath = this.pathFor(reference);
    const temporaryPath = join(this.rootPath, `.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    return reference;
  }

  public async getText(reference: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(reference)) {
      throw new Error('Invalid change artifact reference.');
    }
    const bytes = await readFile(this.pathFor(reference));
    if (bytes.byteLength > maximumArtifactBytes) {
      throw new Error('Change artifact exceeds the 2 MB review limit.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  private pathFor(reference: string): string {
    return join(this.rootPath, `${reference}.artifact`);
  }
}
