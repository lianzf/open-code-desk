import { ipcMain } from 'electron';
import {
  acknowledgeCrashReportRequestSchema,
  acknowledgeCrashReportResponseSchema,
  crashReportChannels,
  crashReportListSchema,
  listCrashReportsRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { CrashReportService } from '../crash/crash-report.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerCrashReportsIpc(
  options: TrustedRendererOptions,
  service: CrashReportService,
): void {
  ipcMain.handle(crashReportChannels.list, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listCrashReportsRequestSchema.parse(untrustedInput);
    return crashReportListSchema.parse(service.list(input.limit));
  });

  ipcMain.handle(crashReportChannels.acknowledge, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = acknowledgeCrashReportRequestSchema.parse(untrustedInput);
    return acknowledgeCrashReportResponseSchema.parse({
      acknowledged: service.acknowledge(input.reportId),
    });
  });
}

export function unregisterCrashReportsIpc(): void {
  Object.values(crashReportChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
