import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { redactAuditText } from '../audit/audit-log.service';

const maximumLogBytes = 128 * 1024;
const maximumMessageCharacters = 1_000;

export interface StartupFailureRecord {
  readonly message: string;
  readonly logPath?: string;
}

export function recordStartupFailure(
  userDataPath: string,
  error: unknown,
  now = new Date(),
): StartupFailureRecord {
  const rawMessage = error instanceof Error ? error.message : '应用初始化过程中发生未知错误。';
  const message = redactAuditText(rawMessage).slice(0, maximumMessageCharacters);
  const logPath = join(userDataPath, 'startup-errors.log');
  const line = `${JSON.stringify({
    at: now.toISOString(),
    event: 'startup_failed',
    message,
  })}\n`;

  try {
    mkdirSync(userDataPath, { recursive: true });
    const existingSize = statSync(logPath, { throwIfNoEntry: false })?.size ?? 0;
    if (existingSize + Buffer.byteLength(line, 'utf8') > maximumLogBytes) {
      writeFileSync(logPath, line, 'utf8');
    } else {
      appendFileSync(logPath, line, 'utf8');
    }
    return { message, logPath };
  } catch {
    // The startup prompt still needs to be shown when the fallback log cannot
    // be created, for example because the user-data directory is read-only.
    return { message };
  }
}
