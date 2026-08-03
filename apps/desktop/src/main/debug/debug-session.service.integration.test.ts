import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DebugEvent, DebugSessionStatus } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import { ProjectTaskExecutionRepository } from '../project-tasks/project-task-execution.repository';
import { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import { ProjectTaskRepository } from '../project-tasks/project-task.repository';
import { ProjectTaskService } from '../project-tasks/project-task.service';
import { RunConfigurationRepository } from '../run/run-configuration.repository';
import { RunConfigurationService } from '../run/run-configuration.service';
import { RunProcessSupervisor } from '../run/run-process-supervisor';
import type { SecretStore } from '../security/secret-store';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { DebugAdapterRegistry } from './debug-adapter.registry';
import { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugSessionRepository } from './debug-session.repository';
import { DebugSessionService } from './debug-session.service';
import { DebugSettingsRepository } from './debug-settings.repository';
import { DebugWatchRepository } from './debug-watch.repository';
import { NodeDebugAdapterProvider } from './node/node-debug-adapter.provider';

const temporaryPaths: string[] = [];
const databases: AppDatabase[] = [];
const services: DebugSessionService[] = [];
const taskExecutionServices: ProjectTaskExecutionService[] = [];

class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  public async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  public async get(ref: string): Promise<string | null> {
    return this.values.get(ref) ?? null;
  }

  public async has(ref: string): Promise<boolean> {
    return this.values.has(ref);
  }

  public async delete(ref: string): Promise<boolean> {
    return this.values.delete(ref);
  }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(taskExecutionServices.splice(0).map((service) => service.close()));
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('DebugSessionService integration', () => {
  it('persists approval, hits a real breakpoint, exposes locals and cleans the adapter process', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-service-'));
    temporaryPaths.push(rootPath);
    const database = createAppDatabase(join(rootPath, 'application.sqlite'));
    databases.push(database);
    await writeFile(
      join(rootPath, 'program.js'),
      [
        'function add(left, right) {',
        '  const total = left + right;',
        '  return total;',
        '}',
        'console.log(add(7, 8));',
      ].join('\n'),
      'utf8',
    );
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(rootPath);
    const workspaceService = new WorkspaceService(workspaceRepository, {
      async pickDirectory() {
        return null;
      },
    });
    await workspaceService.openRecent(workspace.id);
    const secrets = new MemorySecretStore();
    const configurationRepository = new RunConfigurationRepository(database);
    const taskRepository = new ProjectTaskRepository(database);
    const taskService = new ProjectTaskService(taskRepository, secrets, configurationRepository);
    const taskExecutionRepository = new ProjectTaskExecutionRepository(database);
    const taskExecutionService = new ProjectTaskExecutionService(
      taskRepository,
      taskExecutionRepository,
      workspaceService,
      secrets,
      new RunProcessSupervisor({ gracefulStopTimeoutMs: 200 }),
    );
    taskExecutionServices.push(taskExecutionService);
    const preLaunchTask = await taskService.save({
      workspaceId: workspace.id,
      name: 'debug prepare',
      type: 'build',
      executable: process.execPath,
      args: ['-e', 'require("node:fs").appendFileSync("debug-hooks.txt", "pre\\n");'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const postDebugTask = await taskService.save({
      workspaceId: workspace.id,
      name: 'debug cleanup',
      type: 'clean',
      executable: process.execPath,
      args: ['-e', 'require("node:fs").appendFileSync("debug-hooks.txt", "post\\n");'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const configuration = await new RunConfigurationService(
      configurationRepository,
      secrets,
      taskRepository,
    ).save({
      workspaceId: workspace.id,
      name: '真实 Node 调试',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: [],
      args: ['program.js'],
      workingDirectory: '',
      environmentVariables: [
        { name: 'DEBUG_SECRET', value: 'service-debug-secret', sensitive: true },
      ],
      preLaunchTaskId: preLaunchTask.id,
      postRunTaskId: postDebugTask.id,
      console: 'runOutput',
      autoGenerated: false,
    });
    const registry = new DebugAdapterRegistry();
    registry.register(
      new NodeDebugAdapterProvider({
        executable: process.execPath,
        serverPath: join(
          process.cwd(),
          'apps',
          'desktop',
          'vendor',
          'js-debug-1.117.0',
          'src',
          'dapDebugServer.js',
        ),
      }),
    );
    const sessionRepository = new DebugSessionRepository(database);
    const breakpointRepository = new DebugBreakpointRepository(database);
    const watchRepository = new DebugWatchRepository(database);
    const service = new DebugSessionService(
      configurationRepository,
      sessionRepository,
      breakpointRepository,
      new DebugSettingsRepository(database),
      watchRepository,
      workspaceService,
      secrets,
      registry,
      undefined,
      taskExecutionService,
    );
    services.push(service);
    await service.configuration.breakpoints.save({
      workspaceId: workspace.id,
      relativePath: 'program.js',
      line: 3,
      enabled: true,
    });
    const watch = service.configuration.watches.save({
      workspaceId: workspace.id,
      expression: 'total',
    });

    const proposal = await service.proposeStart({
      workspaceId: workspace.id,
      configurationId: configuration.id,
    });
    expect(proposal.status).toBe('pending_approval');
    expect(proposal.command.preLaunchTaskPlan?.rootTaskId).toBe(preLaunchTask.id);
    expect(proposal.command.postRunTaskPlan?.rootTaskId).toBe(postDebugTask.id);
    const pausedEvent = waitForStatus(service, 'paused');
    const running = await service.decideStart({
      sessionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    const paused = (await pausedEvent).session;

    expect(running.status).toBe('starting');
    expect(paused).toMatchObject({
      status: 'paused',
      pause: { reason: 'breakpoint', relativePath: 'program.js', line: 3 },
    });
    const threads = await service.threads(proposal.id);
    const frames = await service.stackTrace(proposal.id, threads[0]?.id ?? 0);
    const scopes = await service.scopes(proposal.id, frames[0]?.id ?? 0);
    const locals = await service.variables(
      proposal.id,
      scopes.find((scope) => /local/iu.test(scope.name))?.variablesReference ??
        scopes[0]?.variablesReference ??
        0,
    );
    expect(locals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'left', value: '7' }),
        expect.objectContaining({ name: 'right', value: '8' }),
        expect.objectContaining({ name: 'total', value: '15' }),
      ]),
    );
    expect(service.configuration.breakpoints.list({ workspaceId: workspace.id })[0]?.status).toBe(
      'verified',
    );
    expect(service.configuration.watches.list({ workspaceId: workspace.id })).toContainEqual(watch);

    const originalAdapterProcessId = paused.adapterProcessId;
    const restartedPause = waitForStatus(service, 'paused');
    await service.restart(proposal.id);
    const pausedAgain = (await restartedPause).session;
    expect(pausedAgain.pause).toMatchObject({ relativePath: 'program.js', line: 3 });
    if (originalAdapterProcessId !== undefined) await expectProcessToExit(originalAdapterProcessId);

    const adapterProcessId = pausedAgain.adapterProcessId;
    const stopped = await service.stop(proposal.id);
    expect(stopped.status).toBe('stopped');
    expect(await readFile(join(rootPath, 'debug-hooks.txt'), 'utf8')).toBe('pre\npre\npost\n');
    expect(taskExecutionRepository.list(workspace.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rootTaskId: preLaunchTask.id, status: 'completed' }),
        expect.objectContaining({ rootTaskId: postDebugTask.id, status: 'completed' }),
      ]),
    );
    if (adapterProcessId !== undefined) await expectProcessToExit(adapterProcessId);
    const rawDatabase = database.client
      .prepare('SELECT command_snapshot, output_tail, pause FROM debug_sessions WHERE id = ?')
      .get(proposal.id);
    expect(JSON.stringify(rawDatabase)).not.toContain('service-debug-secret');
  }, 30_000);
});

function waitForStatus(
  service: DebugSessionService,
  status: DebugSessionStatus,
): Promise<Extract<DebugEvent, { type: 'status' }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for debug status ${status}.`));
    }, 15_000);
    const unsubscribe = service.subscribe((event) => {
      if (event.type === 'status' && event.session.status === status) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

async function expectProcessToExit(processId: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(processId, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Debug adapter process ${processId} did not exit.`);
}
