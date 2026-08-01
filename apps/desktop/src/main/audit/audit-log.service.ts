import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import type { AuditActor, AuditCategory, AuditEvent, AuditOutcome } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { auditEvents } from '../database/schema';

type AuditMetadataValue = string | number | boolean | null;

export interface RecordAuditEventInput {
  readonly workspaceId: string;
  readonly conversationId?: string;
  readonly taskId?: string;
  readonly actor: AuditActor;
  readonly category: AuditCategory;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly summary: string;
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

export interface ListAuditEventsInput {
  readonly workspaceId: string;
  readonly conversationId?: string;
  readonly limit: number;
}

const sensitiveKeyPattern = /authorization|api.?key|cookie|credential|password|secret|token/i;
const bearerPattern = /\bBearer\s+\S+/gi;
const secretShapePattern =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g;

export function redactAuditText(value: string): string {
  return value
    .replaceAll(bearerPattern, 'Bearer [REDACTED]')
    .replaceAll(secretShapePattern, '[REDACTED]');
}

function sanitizeMetadata(
  metadata: Readonly<Record<string, AuditMetadataValue>>,
): Readonly<Record<string, AuditMetadataValue>> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key.slice(0, 100),
      sensitiveKeyPattern.test(key)
        ? '[REDACTED]'
        : typeof value === 'string'
          ? redactAuditText(value).slice(0, 2_000)
          : value,
    ]),
  );
}

function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ...(row.conversationId === null ? {} : { conversationId: row.conversationId }),
    ...(row.taskId === null ? {} : { taskId: row.taskId }),
    actor: row.actor as AuditActor,
    category: row.category as AuditCategory,
    action: row.action,
    outcome: row.outcome as AuditOutcome,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

export class AuditLogService {
  public constructor(private readonly database: AppDatabase) {}

  public record(input: RecordAuditEventInput): AuditEvent {
    const row = this.database.orm
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        conversationId: input.conversationId ?? null,
        taskId: input.taskId ?? null,
        actor: input.actor,
        category: input.category,
        action: input.action.slice(0, 200),
        outcome: input.outcome,
        summary: redactAuditText(input.summary).slice(0, 1_000),
        metadata: sanitizeMetadata(input.metadata ?? {}),
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    return toAuditEvent(row);
  }

  public list(input: ListAuditEventsInput): ReadonlyArray<AuditEvent> {
    return this.database.orm
      .select()
      .from(auditEvents)
      .where(
        input.conversationId === undefined
          ? eq(auditEvents.workspaceId, input.workspaceId)
          : and(
              eq(auditEvents.workspaceId, input.workspaceId),
              eq(auditEvents.conversationId, input.conversationId),
            ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(Math.min(Math.max(input.limit, 1), 500))
      .all()
      .map(toAuditEvent);
  }
}
