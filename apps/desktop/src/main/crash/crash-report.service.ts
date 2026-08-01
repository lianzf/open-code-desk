import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';
import type { CrashProcessType, CrashReport } from '@open-code-desk/ipc-contracts';

import { redactAuditText } from '../audit/audit-log.service';
import type { AppDatabase } from '../database/database';
import { crashReports } from '../database/schema';

type CrashDetailValue = string | number | boolean | null;

interface NativeCrashReporter {
  start(options: {
    readonly companyName: string;
    readonly productName: string;
    readonly submitURL: string;
    readonly uploadToServer: boolean;
    readonly compress: boolean;
    readonly extra: Readonly<Record<string, string>>;
  }): void;
}

export interface RecordCrashReportInput {
  readonly processType: CrashProcessType;
  readonly reason: string;
  readonly exitCode?: number;
  readonly details?: Readonly<Record<string, CrashDetailValue>>;
}

const sensitiveKeyPattern = /authorization|api.?key|cookie|credential|password|secret|token/i;

function sanitizeDetails(
  details: Readonly<Record<string, CrashDetailValue>>,
): Readonly<Record<string, CrashDetailValue>> {
  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 30)
      .map(([key, value]) => [
        key.slice(0, 100),
        sensitiveKeyPattern.test(key)
          ? '[REDACTED]'
          : typeof value === 'string'
            ? redactAuditText(value).slice(0, 2_000)
            : value,
      ]),
  );
}

function toCrashReport(row: typeof crashReports.$inferSelect): CrashReport {
  return {
    id: row.id,
    processType: row.processType as CrashProcessType,
    reason: row.reason,
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    appVersion: row.appVersion,
    details: row.details,
    createdAt: row.createdAt,
    ...(row.acknowledgedAt === null ? {} : { acknowledgedAt: row.acknowledgedAt }),
  };
}

export class CrashReportService {
  private enabled: boolean;
  private nativeReporterStarted = false;
  private readonly rendererRecoveryTimes: number[] = [];

  public constructor(
    private readonly database: AppDatabase,
    private readonly appVersion: string,
    enabled: boolean,
  ) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean, nativeReporter?: NativeCrashReporter): void {
    this.enabled = enabled;
    if (enabled && nativeReporter !== undefined) {
      this.startNativeReporter(nativeReporter);
    }
  }

  public startNativeReporter(nativeReporter: NativeCrashReporter): void {
    if (!this.enabled || this.nativeReporterStarted) {
      return;
    }
    nativeReporter.start({
      companyName: 'OpenCode Desk',
      productName: 'OpenCode Desk',
      submitURL: '',
      uploadToServer: false,
      compress: true,
      extra: { appVersion: this.appVersion },
    });
    this.nativeReporterStarted = true;
  }

  public record(input: RecordCrashReportInput): CrashReport | null {
    if (!this.enabled) {
      return null;
    }
    const row = this.database.orm
      .insert(crashReports)
      .values({
        id: randomUUID(),
        processType: input.processType,
        reason: redactAuditText(input.reason).slice(0, 200),
        exitCode: input.exitCode ?? null,
        appVersion: this.appVersion,
        details: sanitizeDetails(input.details ?? {}),
        createdAt: new Date().toISOString(),
        acknowledgedAt: null,
      })
      .returning()
      .get();
    return toCrashReport(row);
  }

  public list(limit: number): ReadonlyArray<CrashReport> {
    return this.database.orm
      .select()
      .from(crashReports)
      .orderBy(desc(crashReports.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
      .all()
      .map(toCrashReport);
  }

  public acknowledge(reportId: string): boolean {
    return (
      this.database.orm
        .update(crashReports)
        .set({ acknowledgedAt: new Date().toISOString() })
        .where(eq(crashReports.id, reportId))
        .returning({ id: crashReports.id })
        .get() !== undefined
    );
  }

  public shouldRecoverRenderer(now = Date.now()): boolean {
    const recoveryWindowStart = now - 60_000;
    while (
      this.rendererRecoveryTimes[0] !== undefined &&
      this.rendererRecoveryTimes[0] < recoveryWindowStart
    ) {
      this.rendererRecoveryTimes.shift();
    }
    if (this.rendererRecoveryTimes.length >= 2) {
      return false;
    }
    this.rendererRecoveryTimes.push(now);
    return true;
  }
}
