import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectTaskEvent, RunStatus } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { AuditLogService } from '../audit/audit-log.service';
import { createAppDatabase, type AppDatabase } from '../database/database';
import { RunProcessSupervisor } from '../run/run-process-supervisor';
import type { SecretStore } from '../security/secret-store';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { ProjectTaskExecutionRepository } from './project-task-execution.repository';
import { ProjectTaskExecutionService } from './project-task-execution.service';
import { ProjectTaskRepository } from './project-task.repository';
import { ProjectTaskService } from './project-task.service';

const temporaryPaths: string[] = [];
const services: ProjectTaskExecutionService[] = [];
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
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-project-task-'));
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
  const taskRepository = new ProjectTaskRepository(database);
  const taskService = new ProjectTaskService(taskRepository, secrets);
  const executionRepository = new ProjectTaskExecutionRepository(database);
  const executionService = new ProjectTaskExecutionService(
    taskRepository,
    executionRepository,
    workspaceService,
    secrets,
    new RunProcessSupervisor({ gracefulStopTimeoutMs: 200 }),
    new AuditLogService(database),
  );
  services.push(executionService);
  return {
    rootPath,
    database,
    workspace,
    taskService,
    executionRepository,
    executionService,
  };
}

function waitForStatus(
  service: ProjectTaskExecutionService,
  status: RunStatus,
): Promise<ProjectTaskEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for project task status ${status}.`));
    }, 8_000);
    const unsubscribe = service.subscribe((event) => {
      if (event.type === 'status' && event.execution.status === status) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

describe('ProjectTaskExecutionService integration', () => {
  it('runs dependencies once in order and redacts secrets from output and history', async () => {
    const fixture = await createFixture();
    const secret = 'project-task-super-secret';
    const dependency = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'prepare',
      type: 'build',
      executable: process.execPath,
      args: [
        '-e',
        'require("node:fs").appendFileSync("order.txt", "prepare\\n"); process.stdout.write(process.env.TASK_SECRET);',
      ],
      workingDirectory: '',
      environmentVariables: [{ name: 'TASK_SECRET', value: secret, sensitive: true }],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const root = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'verify',
      type: 'test',
      executable: process.execPath,
      args: [
        '-e',
        'require("node:fs").appendFileSync("order.txt", "verify\\n"); process.stdout.write("done");',
      ],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [dependency.id],
      timeoutMs: 5_000,
    });
    const outputEvents: string[] = [];
    fixture.executionService.subscribe((event) => {
      if (event.type === 'output') outputEvents.push(event.data);
    });

    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      taskId: root.id,
    });
    expect(proposal.plan.map((step) => step.taskName)).toEqual(['prepare', 'verify']);
    expect(proposal.plan[0]?.environmentVariables[0]).toMatchObject({
      name: 'TASK_SECRET',
      sensitive: true,
      configured: true,
    });
    expect(JSON.stringify(proposal)).not.toContain(secret);

    const completedEvent = waitForStatus(fixture.executionService, 'completed');
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    await completedEvent;

    expect(await readFile(join(fixture.rootPath, 'order.txt'), 'utf8')).toBe('prepare\nverify\n');
    const completed = fixture.executionRepository.findById(proposal.id);
    expect(completed).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(completed?.outputTail).toContain('[REDACTED]');
    expect(completed?.outputTail).toContain('done');
    expect(completed?.outputTail).not.toContain(secret);
    expect(outputEvents.join('')).not.toContain(secret);
    const raw = fixture.database.client
      .prepare('SELECT plan_snapshot, output_tail FROM project_task_executions WHERE id = ?')
      .get(proposal.id);
    expect(JSON.stringify(raw)).not.toContain(secret);
  });

  it('invalidates approval when any planned task changes', async () => {
    const fixture = await createFixture();
    const task = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'stale',
      type: 'custom',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("first")'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      taskId: task.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fixture.taskService.save({
      id: task.id,
      workspaceId: fixture.workspace.id,
      name: task.name,
      type: task.type,
      executable: task.executable,
      args: ['-e', 'process.stdout.write("changed")'],
      workingDirectory: task.workingDirectory,
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: task.timeoutMs,
    });

    const failed = await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    expect(failed).toMatchObject({
      status: 'failed',
      approvalDecision: 'approve',
      error: { code: 'PROJECT_TASK_CHANGED', retryable: true },
    });
    expect(failed.outputTail).toBe('');
  });

  it('short-circuits dependents after failure and can stop and restart a long task', async () => {
    const fixture = await createFixture();
    const failing = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'failing dependency',
      type: 'test',
      executable: process.execPath,
      args: ['-e', 'process.stderr.write("failed"); process.exit(7);'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 5_000,
    });
    const skipped = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'must not run',
      type: 'custom',
      executable: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync("unexpected.txt", "ran")'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [failing.id],
      timeoutMs: 5_000,
    });
    const failedProposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      taskId: skipped.id,
    });
    const failedEvent = waitForStatus(fixture.executionService, 'failed');
    await fixture.executionService.decideStart({
      executionId: failedProposal.id,
      expectedApprovalDigest: failedProposal.approvalDigest,
      decision: 'approve',
    });
    await failedEvent;
    await expect(access(join(fixture.rootPath, 'unexpected.txt'))).rejects.toThrow();
    expect(fixture.executionRepository.findById(failedProposal.id)).toMatchObject({
      status: 'failed',
      exitCode: 7,
      error: { code: 'PROJECT_TASK_STEP_FAILED' },
    });

    const longTask = await fixture.taskService.save({
      workspaceId: fixture.workspace.id,
      name: 'long service',
      type: 'start',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("ready"); setInterval(() => undefined, 1000);'],
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutMs: 60_000,
    });
    const proposal = await fixture.executionService.proposeStart({
      workspaceId: fixture.workspace.id,
      taskId: longTask.id,
    });
    const running = waitForStatus(fixture.executionService, 'running');
    await fixture.executionService.decideStart({
      executionId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
    });
    await running;
    const stopped = await fixture.executionService.stop({ executionId: proposal.id });
    expect(stopped.status).toBe('stopped');

    const restarted = await fixture.executionService.restart({ executionId: proposal.id });
    expect(restarted).toMatchObject({
      status: 'pending_approval',
      restartOfExecutionId: proposal.id,
    });
    expect(restarted.approvalDigest).not.toBe(proposal.approvalDigest);
  });
});
