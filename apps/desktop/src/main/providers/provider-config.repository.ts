import { desc, eq } from 'drizzle-orm';
import type { ProviderKind } from '@open-code-desk/provider-core';

import type { AppDatabase } from '../database/database';
import { providerConfigs } from '../database/schema';

export interface StoredProviderConfig {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly fastModel?: string;
  readonly reasoningModel?: string;
  readonly contextWindow: number;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly streaming: boolean;
  readonly customHeaders: Readonly<Record<string, string>>;
  readonly sensitiveHeaderNames: ReadonlyArray<string>;
  readonly hasApiKey: boolean;
  readonly secretRef?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveStoredProviderConfig {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly fastModel?: string;
  readonly reasoningModel?: string;
  readonly contextWindow: number;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly streaming: boolean;
  readonly customHeaders: Readonly<Record<string, string>>;
  readonly sensitiveHeaderNames: ReadonlyArray<string>;
  readonly hasApiKey: boolean;
  readonly secretRef?: string;
}

type ProviderRow = typeof providerConfigs.$inferSelect;

function toStoredConfig(row: ProviderRow): StoredProviderConfig {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    ...(row.fastModel === null ? {} : { fastModel: row.fastModel }),
    ...(row.reasoningModel === null ? {} : { reasoningModel: row.reasoningModel }),
    contextWindow: row.contextWindow,
    toolCalling: row.toolCalling,
    vision: row.vision,
    streaming: row.streaming,
    customHeaders: row.customHeaders,
    sensitiveHeaderNames: row.sensitiveHeaderNames,
    hasApiKey: row.hasApiKey,
    ...(row.secretRef === null ? {} : { secretRef: row.secretRef }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProviderConfigRepository {
  public constructor(private readonly database: AppDatabase) {}

  public findById(providerId: string): StoredProviderConfig | null {
    const row = this.database.orm
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, providerId))
      .get();
    return row === undefined ? null : toStoredConfig(row);
  }

  public list(): ReadonlyArray<StoredProviderConfig> {
    return this.database.orm
      .select()
      .from(providerConfigs)
      .orderBy(desc(providerConfigs.updatedAt))
      .all()
      .map(toStoredConfig);
  }

  public save(input: SaveStoredProviderConfig): StoredProviderConfig {
    const existing = this.findById(input.id);
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(providerConfigs)
      .values({
        ...input,
        fastModel: input.fastModel ?? null,
        reasoningModel: input.reasoningModel ?? null,
        secretRef: input.secretRef ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: providerConfigs.id,
        set: {
          kind: input.kind,
          displayName: input.displayName,
          baseUrl: input.baseUrl,
          defaultModel: input.defaultModel,
          fastModel: input.fastModel ?? null,
          reasoningModel: input.reasoningModel ?? null,
          contextWindow: input.contextWindow,
          toolCalling: input.toolCalling,
          vision: input.vision,
          streaming: input.streaming,
          customHeaders: input.customHeaders,
          sensitiveHeaderNames: input.sensitiveHeaderNames,
          hasApiKey: input.hasApiKey,
          secretRef: input.secretRef ?? null,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    return toStoredConfig(row);
  }

  public delete(providerId: string): boolean {
    const result = this.database.orm
      .delete(providerConfigs)
      .where(eq(providerConfigs.id, providerId))
      .returning({ id: providerConfigs.id })
      .get();
    return result !== undefined;
  }
}
