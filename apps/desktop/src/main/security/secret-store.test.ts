import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import { SecretRepository } from './secret.repository';
import { SecureSecretStore, type DecryptedSecret, type SecretCryptography } from './secret-store';

const temporaryPaths: string[] = [];

class TestCryptography implements SecretCryptography {
  public async assertAvailable(): Promise<void> {}

  public async encrypt(value: string): Promise<Buffer> {
    return Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`);
  }

  public async decrypt(encryptedValue: Buffer): Promise<DecryptedSecret> {
    const encoded = encryptedValue.toString().replace(/^encrypted:/, '');
    return {
      value: Buffer.from(encoded, 'base64').toString(),
      needsReEncryption: false,
    };
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

describe('SecureSecretStore', () => {
  it('round-trips an encrypted secret without storing its plaintext in SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-code-desk-secret-'));
    temporaryPaths.push(directory);
    const databasePath = join(directory, 'application.sqlite');
    const database = createAppDatabase(databasePath);
    const store = new SecureSecretStore(new SecretRepository(database), new TestCryptography());
    const secret = 'local-integration-secret-sentinel';

    await store.set('provider:test', secret);
    expect(await store.get('provider:test')).toBe(secret);
    expect(await store.has('provider:test')).toBe(true);
    database.close();

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(secret))).toBe(false);
  });

  it('deletes an encrypted secret by reference', async () => {
    const database = createAppDatabase(':memory:');
    const store = new SecureSecretStore(new SecretRepository(database), new TestCryptography());

    await store.set('provider:test', 'secret');
    expect(await store.delete('provider:test')).toBe(true);
    expect(await store.get('provider:test')).toBeNull();
    database.close();
  });
});
