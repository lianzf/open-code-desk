import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  DebugAdapterCapabilities,
  DebugPauseLocation,
  DebugSession,
  DebugSessionError,
  DebugSessionStatus,
  RunApprovalDecision,
  RunCommandSnapshot,
  RunRiskLevel,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { debugSessions } from '../database/schema';

type DebugSessionRow = typeof debugSessions.$inferSelect;

export interface CreateDebugSessionInput {
  readonly id?: string;
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly adapterType: string;
  readonly command: RunCommandSnapshot;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
}

export interface UpdateDebugSessionInput {
  readonly status?: DebugSessionStatus;
  readonly approvalDecision?: RunApprovalDecision | null;
  readonly adapterProcessId?: number | null;
  readonly capabilities?: DebugAdapterCapabilities | null;
  readonly pause?: DebugPauseLocation | null;
  readonly outputTail?: string;
  readonly outputBytes?: number;
  readonly error?: DebugSessionError | null;
  readonly approvalDecidedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

function assertSafeSnapshot(configurationId: string, command: RunCommandSnapshot): void {
  if (command.configurationId !== configurationId) {
    throw new Error('调试命令快照与运行配置不匹配。');
  }
  if (
    command.environmentVariables.some(
      (variable) => variable.sensitive && variable.value !== undefined,
    )
  ) {
    throw new Error('调试命令快照不得保存敏感环境变量明文。');
  }
}

function toSession(row: DebugSessionRow): DebugSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    configurationId: row.configurationId,
    adapterType: row.adapterType,
    command: row.commandSnapshot,
    status: row.status,
    riskLevel: row.riskLevel,
    riskReasons: row.riskReasons,
    approvalDigest: row.approvalDigest,
    ...(row.approvalDecision === null ? {} : { approvalDecision: row.approvalDecision }),
    ...(row.adapterProcessId === null ? {} : { adapterProcessId: row.adapterProcessId }),
    ...(row.capabilities === null ? {} : { capabilities: row.capabilities }),
    ...(row.pause === null ? {} : { pause: row.pause }),
    outputTail: row.outputTail,
    outputBytes: row.outputBytes,
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.approvalDecidedAt === null ? {} : { approvalDecidedAt: row.approvalDecidedAt }),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  };
}

export class DebugSessionRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(input: CreateDebugSessionInput): DebugSession {
    assertSafeSnapshot(input.configurationId, input.command);
    const now = new Date().toISOString();
    return toSession(
      this.database.orm
        .insert(debugSessions)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          configurationId: input.configurationId,
          adapterType: input.adapterType,
          commandSnapshot: input.command,
          status: 'pending_approval',
          riskLevel: input.riskLevel,
          riskReasons: input.riskReasons,
          approvalDigest: input.approvalDigest,
          approvalDecision: null,
          adapterProcessId: null,
          capabilities: null,
          pause: null,
          outputTail: '',
          outputBytes: 0,
          error: null,
          createdAt: now,
          updatedAt: now,
          approvalDecidedAt: null,
          startedAt: null,
          completedAt: null,
        })
        .returning()
        .get(),
    );
  }

  public findById(sessionId: string): DebugSession | null {
    const row = this.database.orm
      .select()
      .from(debugSessions)
      .where(eq(debugSessions.id, sessionId))
      .get();
    return row === undefined ? null : toSession(row);
  }

  public list(workspaceId: string, limit = 100): ReadonlyArray<DebugSession> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('调试历史数量必须在 1 到 1000 之间。');
    }
    return this.database.orm
      .select()
      .from(debugSessions)
      .where(eq(debugSessions.workspaceId, workspaceId))
      .orderBy(desc(debugSessions.createdAt), desc(debugSessions.id))
      .limit(limit)
      .all()
      .map(toSession);
  }

  public update(sessionId: string, update: UpdateDebugSessionInput): DebugSession {
    const existing = this.findById(sessionId);
    if (existing === null) {
      throw new Error('找不到调试会话。');
    }
    const now = new Date();
    const previousUpdatedAt = new Date(existing.updatedAt);
    const updatedAt = new Date(
      Math.max(now.getTime(), previousUpdatedAt.getTime() + 1),
    ).toISOString();
    const row = this.database.orm
      .update(debugSessions)
      .set({ ...update, updatedAt })
      .where(eq(debugSessions.id, sessionId))
      .returning()
      .get();
    if (row === undefined) throw new Error('找不到调试会话。');
    return toSession(row);
  }

  public recoverInterrupted(): number {
    const now = new Date().toISOString();
    const recovered = this.database.orm
      .update(debugSessions)
      .set({
        status: 'failed',
        adapterProcessId: null,
        pause: null,
        error: {
          code: 'DEBUG_INTERRUPTED',
          message: '应用关闭前调试会话尚未结束，请重新启动调试。',
          retryable: true,
        },
        updatedAt: now,
        completedAt: now,
      })
      .where(
        and(
          inArray(debugSessions.status, ['starting', 'running', 'paused', 'stopping']),
          eq(debugSessions.approvalDecision, 'approve'),
        ),
      )
      .run();
    return Number(recovered.changes);
  }
}
