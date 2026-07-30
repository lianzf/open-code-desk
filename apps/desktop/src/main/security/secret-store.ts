import { safeStorage } from 'electron';

import { SecretRepository } from './secret.repository';

export interface DecryptedSecret {
  readonly value: string;
  readonly needsReEncryption: boolean;
}

export interface SecretCryptography {
  assertAvailable(): Promise<void>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(encryptedValue: Buffer): Promise<DecryptedSecret>;
}

export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  has(ref: string): Promise<boolean>;
  delete(ref: string): Promise<boolean>;
}

export class SecretStoreUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SecretStoreUnavailableError';
  }
}

export class ElectronSafeStorageCryptography implements SecretCryptography {
  public async assertAvailable(): Promise<void> {
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend();
      if (backend === 'basic_text' || backend === 'unknown') {
        throw new SecretStoreUnavailableError(
          '系统安全凭据服务不可用。请启用 Secret Service 或 KWallet 后重试。',
        );
      }
    }

    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new SecretStoreUnavailableError(
        '操作系统安全凭据服务当前不可用，密钥未保存。请解锁系统凭据库后重试。',
      );
    }
  }

  public async encrypt(value: string): Promise<Buffer> {
    await this.assertAvailable();
    return safeStorage.encryptStringAsync(value);
  }

  public async decrypt(encryptedValue: Buffer): Promise<DecryptedSecret> {
    await this.assertAvailable();
    const decrypted = await safeStorage.decryptStringAsync(encryptedValue);
    return {
      value: decrypted.result,
      needsReEncryption: decrypted.shouldReEncrypt,
    };
  }
}

export class SecureSecretStore implements SecretStore {
  public constructor(
    private readonly repository: SecretRepository,
    private readonly cryptography: SecretCryptography,
  ) {}

  public async set(ref: string, value: string): Promise<void> {
    const encrypted = await this.cryptography.encrypt(value);
    this.repository.set(ref, encrypted);
  }

  public async get(ref: string): Promise<string | null> {
    const record = this.repository.get(ref);
    if (record === null) {
      return null;
    }

    const decrypted = await this.cryptography.decrypt(record.encryptedValue);
    if (decrypted.needsReEncryption) {
      this.repository.set(ref, await this.cryptography.encrypt(decrypted.value));
    }
    return decrypted.value;
  }

  public async has(ref: string): Promise<boolean> {
    return this.repository.has(ref);
  }

  public async delete(ref: string): Promise<boolean> {
    return this.repository.delete(ref);
  }
}
