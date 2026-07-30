import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../database/database';
import { secureSecrets } from '../database/schema';

export interface EncryptedSecretRecord {
  readonly ref: string;
  readonly encryptedValue: Buffer;
}

export class SecretRepository {
  public constructor(private readonly database: AppDatabase) {}

  public get(ref: string): EncryptedSecretRecord | null {
    const row = this.database.orm
      .select({
        ref: secureSecrets.ref,
        encryptedValue: secureSecrets.encryptedValue,
      })
      .from(secureSecrets)
      .where(eq(secureSecrets.ref, ref))
      .get();
    return row ?? null;
  }

  public has(ref: string): boolean {
    return this.get(ref) !== null;
  }

  public set(ref: string, encryptedValue: Buffer): void {
    const now = new Date().toISOString();
    this.database.orm
      .insert(secureSecrets)
      .values({
        ref,
        encryptedValue,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: secureSecrets.ref,
        set: {
          encryptedValue,
          updatedAt: now,
        },
      })
      .run();
  }

  public delete(ref: string): boolean {
    return (
      this.database.orm
        .delete(secureSecrets)
        .where(eq(secureSecrets.ref, ref))
        .returning({ ref: secureSecrets.ref })
        .get() !== undefined
    );
  }
}
