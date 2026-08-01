import { describe, expect, it, vi } from 'vitest';

import { createAppDatabase } from '../database/database';
import { CrashReportService } from './crash-report.service';

describe('CrashReportService', () => {
  it('persists redacted local reports and supports acknowledgement', () => {
    const database = createAppDatabase(':memory:');
    const service = new CrashReportService(database, '1.2.3', true);

    const report = service.record({
      processType: 'renderer',
      reason: 'crashed with Bearer abc123',
      exitCode: 9,
      details: {
        apiKey: 'sk-secret-value',
        message: 'request used sk-abcdefghijklmnop',
      },
    });

    expect(report).not.toBeNull();
    expect(service.list(10)[0]).toMatchObject({
      processType: 'renderer',
      reason: 'crashed with Bearer [REDACTED]',
      exitCode: 9,
      appVersion: '1.2.3',
      details: {
        apiKey: '[REDACTED]',
        message: 'request used [REDACTED]',
      },
    });
    expect(service.acknowledge(report?.id ?? '')).toBe(true);
    expect(service.list(10)[0]?.acknowledgedAt).toBeDefined();
    database.close();
  });

  it('does not record when disabled and never enables native uploads', () => {
    const database = createAppDatabase(':memory:');
    const service = new CrashReportService(database, '1.2.3', false);
    const start = vi.fn();

    expect(service.record({ processType: 'main', reason: 'disabled' })).toBeNull();
    service.startNativeReporter({ start });
    expect(start).not.toHaveBeenCalled();
    service.setEnabled(true, { start });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ uploadToServer: false }));
    database.close();
  });

  it('limits automatic renderer recovery to two attempts per minute', () => {
    const database = createAppDatabase(':memory:');
    const service = new CrashReportService(database, '1.2.3', true);

    expect(service.shouldRecoverRenderer(1_000)).toBe(true);
    expect(service.shouldRecoverRenderer(2_000)).toBe(true);
    expect(service.shouldRecoverRenderer(3_000)).toBe(false);
    expect(service.shouldRecoverRenderer(62_000)).toBe(true);
    database.close();
  });
});
