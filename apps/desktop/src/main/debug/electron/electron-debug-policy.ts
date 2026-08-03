import type { RunRiskLevel } from '@open-code-desk/domain';

export interface ElectronDebugRiskAssessment {
  readonly level: RunRiskLevel;
  readonly reasons: ReadonlyArray<string>;
}

export function assessElectronDebugRisk(port: number): ElectronDebugRiskAssessment {
  return {
    level: 'medium',
    reasons: [
      `Electron renderer debugging opens a loopback Chromium DevTools endpoint at 127.0.0.1:${port} while the approved session is running.`,
    ],
  };
}
