import { createHash, randomUUID } from 'node:crypto';

import type { DebugSession } from '@open-code-desk/domain';

import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import { prepareRunProposal } from '../run/run-execution-proposal';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugSessionRepository } from './debug-session.repository';

export async function createDebugProposal(input: {
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly adapterType: string;
  readonly configurations: RunConfigurationRepository;
  readonly sessions: DebugSessionRepository;
  readonly workspaces: WorkspaceService;
}): Promise<DebugSession> {
  const prepared = await prepareRunProposal({
    workspaceId: input.workspaceId,
    configurationId: input.configurationId,
    configurations: input.configurations,
    workspaces: input.workspaces,
  });
  const sessionId = randomUUID();
  const approvalDigest = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        purpose: 'debug',
        sessionId,
        workspaceId: input.workspaceId,
        adapterType: input.adapterType,
        command: prepared.command,
        riskLevel: prepared.riskLevel,
        riskReasons: prepared.riskReasons,
      }),
    )
    .digest('hex');
  return input.sessions.create({
    id: sessionId,
    workspaceId: input.workspaceId,
    configurationId: input.configurationId,
    adapterType: input.adapterType,
    command: prepared.command,
    riskLevel: prepared.riskLevel,
    riskReasons: prepared.riskReasons,
    approvalDigest,
  });
}
