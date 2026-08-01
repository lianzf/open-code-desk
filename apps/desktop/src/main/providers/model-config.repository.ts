import { createHash } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import type { ModelCapabilities, ModelInfo } from '@open-code-desk/provider-core';

import type { AppDatabase } from '../database/database';
import { modelConfigs } from '../database/schema';

type ModelConfigRow = typeof modelConfigs.$inferSelect;

function stableModelConfigId(providerId: string, modelId: string): string {
  return createHash('sha256').update(providerId).update('\0').update(modelId).digest('hex');
}

function toCapabilities(row: ModelConfigRow): ModelCapabilities | undefined {
  if (
    row.streaming === null ||
    row.toolCalling === null ||
    row.vision === null ||
    row.reasoning === null ||
    row.structuredOutput === null
  ) {
    return undefined;
  }
  return {
    streaming: row.streaming,
    toolCalling: row.toolCalling,
    vision: row.vision,
    reasoning: row.reasoning,
    structuredOutput: row.structuredOutput,
    ...(row.contextWindow === null ? {} : { contextWindow: row.contextWindow }),
    ...(row.maxOutputTokens === null ? {} : { maxOutputTokens: row.maxOutputTokens }),
  };
}

function toModelInfo(row: ModelConfigRow): ModelInfo {
  const capabilities = toCapabilities(row);
  return {
    id: row.modelId,
    name: row.displayName,
    ...(row.ownedBy === null ? {} : { ownedBy: row.ownedBy }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

export class ModelConfigRepository {
  public constructor(private readonly database: AppDatabase) {}

  public listForProvider(providerId: string): ReadonlyArray<ModelInfo> {
    return this.database.orm
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.providerConfigId, providerId))
      .orderBy(asc(modelConfigs.displayName), asc(modelConfigs.modelId))
      .all()
      .map(toModelInfo);
  }

  public replaceForProvider(
    providerId: string,
    models: ReadonlyArray<ModelInfo>,
  ): ReadonlyArray<ModelInfo> {
    const now = new Date().toISOString();
    const uniqueModels = [...new Map(models.map((model) => [model.id, model])).values()];
    const rows = uniqueModels.map((model) => ({
      id: stableModelConfigId(providerId, model.id),
      providerConfigId: providerId,
      modelId: model.id,
      displayName: model.name,
      ownedBy: model.ownedBy ?? null,
      contextWindow: model.capabilities?.contextWindow ?? null,
      maxOutputTokens: model.capabilities?.maxOutputTokens ?? null,
      streaming: model.capabilities?.streaming ?? null,
      toolCalling: model.capabilities?.toolCalling ?? null,
      vision: model.capabilities?.vision ?? null,
      reasoning: model.capabilities?.reasoning ?? null,
      structuredOutput: model.capabilities?.structuredOutput ?? null,
      createdAt: now,
      updatedAt: now,
    }));

    this.database.orm.transaction((transaction) => {
      transaction.delete(modelConfigs).where(eq(modelConfigs.providerConfigId, providerId)).run();
      if (rows.length > 0) {
        transaction.insert(modelConfigs).values(rows).run();
      }
    });

    return this.listForProvider(providerId);
  }
}
