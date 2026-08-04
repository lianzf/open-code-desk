import { isIP } from 'node:net';

import type { DebugAttachConfiguration, RunRiskLevel } from '@open-code-desk/domain';

export interface DebugAttachRisk {
  readonly level: RunRiskLevel;
  readonly reasons: ReadonlyArray<string>;
}

export function assessDebugAttachRisk(target: DebugAttachConfiguration): DebugAttachRisk {
  const endpoint = `${target.host}:${target.port}`;
  const runtime = target.adapter === 'debugpy' ? 'Python' : 'Node.js';
  if (isLoopbackHost(target.host)) {
    return {
      level: 'medium',
      reasons: [
        target.environment === 'container'
          ? `The debugger will connect to the container target through local port forwarding at ${endpoint}.`
          : `The debugger will connect to an existing local ${runtime} target at ${endpoint}.`,
        'Attach debugging does not start or automatically terminate the target process.',
      ],
    };
  }
  return {
    level: 'high',
    reasons: [
      `The debugger will connect to a remote ${runtime} target over the network at ${endpoint}.`,
      'Remote debug ports can grant control of the program; connect only to a trusted target and network.',
      'Attach debugging does not start or automatically terminate the target process.',
    ],
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLocaleLowerCase('en-US');
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true;
  }
  return isIP(normalized) === 4 && normalized.startsWith('127.');
}
