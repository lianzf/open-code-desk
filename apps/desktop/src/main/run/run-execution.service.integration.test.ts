import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

import type { RunEvent, RunStatus } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import { ProjectTaskExecutionRepository } from '../project-tasks/project-task-execution.repository';
import { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import { ProjectTaskRepository } from '../project-tasks/project-task.repository';
import { ProjectTaskService } from '../project-tasks/project-task.service';
import type { SecretStore } from '../security/secret-store';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { RunConfigurationRepository } from './run-configuration.repository';
import { RunConfigurationService } from './run-configuration.service';
import { RunExecutionRepository } from './run-execution.repository';
import { RunExecutionService } from './run-execution.service';
import { RunProcessSupervisor } from './run-process-supervisor';

const temporaryPaths: string[] = [];
const services: RunExecutionService[] = [];
const taskExecutionServices: ProjectTaskExecutionService[] = [];
const databases: AppDatabase[] = [];

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
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-run-service-'));
  temporaryPaths.push(rootPath);
  const database = createAppDatabase(join(rootPath, 'application.sqlite'));
  databases.push(database);
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
  const configurationService = new RunConfigurationService(
    configurationRepository,
    secrets,
    taskRepository,
  );
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
  const executionRepository = new RunExecutionRepository(database);
  const executionService = new RunExecutionService(
    configurationRepository,
    executionRepository,
    workspaceService,
    secrets,
    new RunProcessSupervisor({ gracefulStopTimeoutMs: 200 }),
    undefined,
    taskExecutionService,
  );
  services.push(executionService);
  return {
    rootPath,
    database,
    workspace,
    configurationService,
    configurationRepository,
    taskService,
    taskExecutionRepository,
    taskExecutionService,
    executionRepository,
    executionService,
  };
}

function waitForStatus(service: RunExecutionService, status: RunStatus): Promise<RunEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for run status ${status}.`));
    }, 5_000);
    const unsubscribe = service.subscribe((event) => {
      if (event.type === 'status' && event.execution.status === status) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

describe('RunExecutionService integration', () => {
  it('requires approval, streams redacted output, and persists a safe completed history', async () => {
    const fixture = await createFixture();
    const markerPath = join(fixture.rootPath, 'started.txt');
    const secret = 'stage-b-sensitive-token';
    const source = [
      'const fs = require("node:fs");',
      'fs.writeFileSync("started.txt", "started");',
      'process.stdout.write(process.env.RUN_SECRET);',
    ].join(' ');
    const configuration = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: '安全运行测试',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: [source],
      workingDirectory: '',
      environmentVariables: [{ name: 'RUN_SECRET', value: secret, sensitive: true }],
      console: 'runOutput',
      autoGenerated: false,
    });
    const events: RunEvent[] = [];
    fixture.executionService.subscribe((event) => events.push(event));

    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: configuration.id,
    });
    await expect(access(markerPath)).rejects.toThrow();
    const completedEvent = waitForStatus(fixture.executionService, 'completed');
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    await completedEvent;

    const completed = fixture.executionRepository.findById(proposal.id);
    expect(completed).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(completed?.outputTail).toContain('[REDACTED]');
    expect(completed?.outputTail).not.toContain(secret);
    expect(
      events.flatMap((event) => (event.type === 'output' ? [event.data] : [])).join(''),
    ).not.toContain(secret);
    const rawDatabase = fixture.database.client
      .prepare('SELECT command_snapshot, output_tail FROM run_executions WHERE id = ?')
      .get(proposal.id) as {
      readonly command_snapshot: string;
      readonly output_tail: string;
    };
    expect(JSON.stringify(rawDatabase)).not.toContain(secret);
  });

  it('stops a long-lived process and creates a separately approved restart proposal', async () => {
    const fixture = await createFixture();
    const configuration = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: '长时服务',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: ['process.stdout.write("ready"); setInterval(() => undefined, 1000);'],
      workingDirectory: '',
      environmentVariables: [],
      console: 'runOutput',
      autoGenerated: false,
    });
    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: configuration.id,
    });
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    const stopped = await fixture.executionService.stop({ executionId: proposal.id });
    expect(stopped.status).toBe('stopped');

    const restarted = await fixture.executionService.restart({ executionId: proposal.id });
    expect(restarted).toMatchObject({
      status: 'pending_approval',
      restartOfExecutionId: proposal.id,
    });
    expect(restarted.approvalDigest).not.toBe(proposal.approvalDigest);
  });

  it('fails safely when an approved environment file changed after review', async () => {
    const fixture = await createFixture();
    const environmentPath = join(fixture.rootPath, '.env.run');
    await writeFile(environmentPath, 'RUN_VALUE=first\n', 'utf8');
    const configuration = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: '环境文件校验',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: ['process.stdout.write(process.env.RUN_VALUE);'],
      workingDirectory: '',
      environmentVariables: [],
      environmentFile: '.env.run',
      console: 'runOutput',
      autoGenerated: false,
    });
    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: configuration.id,
    });
    await writeFile(environmentPath, 'RUN_VALUE=second\n', 'utf8');

    const failedEvent = waitForStatus(fixture.executionService, 'failed');
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    const failedStatus = await failedEvent;
    const failed = failedStatus.type === 'status' ? failedStatus.execution : undefined;
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'RUN_START_FAILED', retryable: true },
    });
    expect(failed?.outputTail).toBe('');
  });

  it('runs approved pre-launch and post-run task plans around the main process', async () => {
    const fixture = await createFixture();
    const preLaunch = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'prepare run',
      type: 'build',
      executable: process.execPath,
      args: [
        '-e',
        'require("node:fs").appendFileSync("hook-order.txt", "pre\\n"); process.stdout.write("PRE_HOOK");',
      ],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const postRun = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'cleanup run',
      type: 'clean',
      executable: process.execPath,
      args: [
        '-e',
        'require("node:fs").appendFileSync("hook-order.txt", "post\\n"); process.stdout.write("POST_HOOK");',
      ],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const configuration = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: 'hooked run',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: ['require("node:fs").appendFileSync("hook-order.txt", "main\\n");'],
      workingDirectory: '',
      environmentVariables: [],
      preLaunchTaskId: preLaunch.id,
      postRunTaskId: postRun.id,
      console: 'runOutput',
      autoGenerated: false,
    });

    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: configuration.id,
    });
    expect(proposal.command.preLaunchTaskPlan?.plan.map((step) => step.taskName)).toEqual([
      'prepare run',
    ]);
    expect(proposal.command.postRunTaskPlan?.plan.map((step) => step.taskName)).toEqual([
      'cleanup run',
    ]);
    const completedEvent = waitForStatus(fixture.executionService, 'completed');
    const starting = await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    expect(starting.status).toBe('starting');
    await completedEvent;

    expect(await readFile(join(fixture.rootPath, 'hook-order.txt'), 'utf8')).toBe(
      'pre\nmain\npost\n',
    );
    expect(fixture.taskExecutionRepository.list(fixture.workspace.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rootTaskId: preLaunch.id, status: 'completed' }),
        expect.objectContaining({ rootTaskId: postRun.id, status: 'completed' }),
      ]),
    );
  });

  it('stops an active pre-launch task before the main process starts', async () => {
    const fixture = await createFixture();
    const preLaunch = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'long prepare',
      type: 'build',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("ready"); setInterval(() => undefined, 1000);'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 60_000,
    });
    const configuration = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: 'blocked by prepare',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: ['require("node:fs").writeFileSync("main-started.txt", "yes")'],
      workingDirectory: '',
      environmentVariables: [],
      preLaunchTaskId: preLaunch.id,
      console: 'runOutput',
      autoGenerated: false,
    });
    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: configuration.id,
    });
    const hookRunning = new Promise<void>((resolve) => {
      const unsubscribe = fixture.taskExecutionService.subscribe((event) => {
        if (event.type === 'status' && event.execution.status === 'running') {
          unsubscribe();
          resolve();
        }
      });
    });
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    await hookRunning;
    const stopped = await fixture.executionService.stop({ executionId: proposal.id });

    expect(stopped.status).toBe('stopped');
    await expect(access(join(fixture.rootPath, 'main-started.txt'))).rejects.toThrow();
    expect(fixture.taskExecutionRepository.list(fixture.workspace.id)[0]?.status).toBe('stopped');
  });

  it('duplicates sensitive configuration values into independent secret references', async () => {
    const fixture = await createFixture();
    const source = await fixture.configurationService.save({
      workspaceId: fixture.workspace.id,
      name: 'secret source',
      type: 'node',
      executable: process.execPath,
      runtimeArgs: ['-e'],
      args: ['process.stdout.write(process.env.COPIED_SECRET)'],
      workingDirectory: '',
      environmentVariables: [
        { name: 'COPIED_SECRET', value: 'independent-secret', sensitive: true },
      ],
      console: 'runOutput',
      autoGenerated: false,
    });
    const duplicated = await fixture.configurationService.duplicate({
      workspaceId: fixture.workspace.id,
      configurationId: source.id,
    });
    const sourceRef = fixture.configurationRepository.findStoredById(source.id)
      ?.environmentVariables[0]?.secretRef;
    const duplicatedRef = fixture.configurationRepository.findStoredById(duplicated.id)
      ?.environmentVariables[0]?.secretRef;
    expect(duplicated.name).toBe('secret source 副本');
    expect(duplicated.environmentVariables[0]).not.toHaveProperty('value');
    expect(sourceRef).toBeDefined();
    expect(duplicatedRef).toBeDefined();
    expect(duplicatedRef).not.toBe(sourceRef);
    await fixture.configurationService.delete({
      workspaceId: fixture.workspace.id,
      configurationId: source.id,
    });

    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      configurationId: duplicated.id,
    });
    const completedEvent = waitForStatus(fixture.executionService, 'completed');
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    await completedEvent;
    expect(fixture.executionRepository.findById(proposal.id)?.outputTail).toBe('[REDACTED]');
  });

  it('detects a port conflict before hooks or the main service start and rejects duplicates', async () => {
    const fixture = await createFixture();
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP port.');
    try {
      const configuration = await fixture.configurationService.save({
        workspaceId: fixture.workspace.id,
        name: 'occupied service',
        type: 'node',
        executable: process.execPath,
        runtimeArgs: ['-e'],
        args: ['require("node:fs").writeFileSync("port-started.txt", "yes")'],
        workingDirectory: '',
        environmentVariables: [],
        port: address.port,
        console: 'runOutput',
        autoGenerated: false,
      });
      const proposal = await fixture.executionService.proposeStart({
        workspaceId: fixture.workspace.id,
        configurationId: configuration.id,
      });
      expect(proposal.command.port).toBe(address.port);
      await expect(
        fixture.executionService.proposeStart({
          workspaceId: fixture.workspace.id,
          configurationId: configuration.id,
        }),
      ).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' });

      const failedEvent = waitForStatus(fixture.executionService, 'failed');
      await fixture.executionService.decideStart({
        executionId: proposal.id,
        expectedApprovalDigest: proposal.approvalDigest,
        decision: 'approve',
      });
      const event = await failedEvent;
      expect(event.type === 'status' ? event.execution.error : undefined).toMatchObject({
        code: 'RUN_PORT_CONFLICT',
      });
      await expect(access(join(fixture.rootPath, 'port-started.txt'))).rejects.toThrow();
    } finally {
      listener.close();
    }
  });
});
