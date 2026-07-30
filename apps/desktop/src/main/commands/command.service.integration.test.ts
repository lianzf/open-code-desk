import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandExecution } from '@open-code-desk/domain';
import type { ToolExecutionContext } from '@open-code-desk/tool-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentTaskRepository } from '../agent/agent-task.repository';
import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase, type AppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import type { CommandLifecycleEvent } from './command-lifecycle';
import { CommandRepository } from './command.repository';
import { CommandService } from './command.service';
import { PermissionRuleRepository } from './permission-rule.repository';

class StaticDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly rootPath: string) {}

  public async pickDirectory(): Promise<string> {
    return this.rootPath;
  }
}

interface Fixture {
  readonly database: AppDatabase;
  readonly rootPath: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly commands: CommandRepository;
  readonly rules: PermissionRuleRepository;
  readonly service: CommandService;
  readonly context: ToolExecutionContext;
}

function waitForEvent(
  service: CommandService,
  taskId: string,
  predicate: (event: CommandLifecycleEvent) => boolean,
): Promise<CommandLifecycleEvent> {
  return new Promise((resolve) => {
    const unsubscribe = service.subscribe(taskId, (event) => {
      if (predicate(event)) {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

function commandFrom(event: CommandLifecycleEvent): CommandExecution {
  if (event.type === 'command_output') {
    throw new Error('Expected a command lifecycle event with a command record.');
  }
  return event.command;
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

describe('CommandService integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-command-'));
    const database = createAppDatabase(':memory:');
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new StaticDirectoryPicker(rootPath),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Expected the test workspace to open.');
    }
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id, { title: 'Command test' });
    const task = new AgentTaskRepository(database).create(conversation.id, crypto.randomUUID());
    const commands = new CommandRepository(database);
    const rules = new PermissionRuleRepository(database);
    const service = new CommandService(commands, rules, workspaces);
    fixture = {
      database,
      rootPath,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      taskId: task.id,
      commands,
      rules,
      service,
      context: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        taskId: task.id,
        callId: crypto.randomUUID(),
        modelCallId: crypto.randomUUID(),
        signal: new AbortController().signal,
      },
    };
  });

  afterEach(async () => {
    fixture.service.close();
    fixture.database.close();
    await rm(fixture.rootPath, { recursive: true, force: true });
  });

  it('does not start before approval, streams output, persists success, and remembers an allow rule', async () => {
    const markerPath = join(fixture.rootPath, 'approved.txt');
    const events: CommandLifecycleEvent[] = [];
    const unsubscribe = fixture.service.subscribe(fixture.taskId, (event) => events.push(event));
    const proposalPromise = waitForEvent(
      fixture.service,
      fixture.taskId,
      (event) => event.type === 'command_proposed',
    );
    const resultPromise = fixture.service.requestAndExecute(
      'run_command',
      {
        executable: process.execPath,
        args: [
          '-e',
          'require("node:fs").writeFileSync("approved.txt", "approved"); process.stdout.write("approved-output");',
        ],
        timeoutMs: 10_000,
      },
      fixture.context,
    );

    const proposed = commandFrom(await proposalPromise);
    expect(proposed.status).toBe('pending_approval');
    expect(await doesNotExist(markerPath)).toBe(true);

    fixture.service.decide({
      commandId: proposed.id,
      expectedApprovalDigest: proposed.approvalDigest,
      decision: 'approve',
      rememberExecutable: true,
    });
    const result = await resultPromise;
    unsubscribe();

    expect(result).toMatchObject({ commandId: proposed.id, status: 'completed', exitCode: 0 });
    expect(result.output).toContain('approved-output');
    expect(await readFile(markerPath, 'utf8')).toBe('approved');
    expect(fixture.commands.findById(proposed.id)).toMatchObject({
      status: 'completed',
      outputTail: expect.stringContaining('approved-output'),
      exitCode: 0,
    });
    expect(events.some((event) => event.type === 'command_output')).toBe(true);
    expect(fixture.rules.list(fixture.workspaceId)).toHaveLength(1);

    const autoApproved = await fixture.service.requestAndExecute(
      'run_command',
      {
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("auto-approved")'],
        timeoutMs: 10_000,
      },
      { ...fixture.context, callId: crypto.randomUUID(), modelCallId: crypto.randomUUID() },
    );
    expect(autoApproved.status).toBe('completed');
    expect(autoApproved.output).toContain('auto-approved');
    expect(fixture.commands.findById(autoApproved.commandId)?.autoApproved).toBe(true);
  });

  it('rejects without side effects and persists a remembered deny rule', async () => {
    const markerPath = join(fixture.rootPath, 'rejected.txt');
    const proposalPromise = waitForEvent(
      fixture.service,
      fixture.taskId,
      (event) => event.type === 'command_proposed',
    );
    const resultPromise = fixture.service.requestAndExecute(
      'run_command',
      {
        executable: process.execPath,
        args: ['-e', 'require("node:fs").writeFileSync("rejected.txt", "unexpected")'],
        timeoutMs: 10_000,
      },
      fixture.context,
    );
    const proposed = commandFrom(await proposalPromise);

    fixture.service.decide({
      commandId: proposed.id,
      expectedApprovalDigest: proposed.approvalDigest,
      decision: 'reject',
      rememberExecutable: true,
    });

    await expect(resultPromise).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'COMMAND_REJECTED' },
    });
    expect(await doesNotExist(markerPath)).toBe(true);
    expect(fixture.rules.list(fixture.workspaceId)[0]?.kind).toBe('deny_executable');

    const deniedAgain = await fixture.service.requestAndExecute(
      'run_command',
      {
        executable: process.execPath,
        args: ['-e', 'require("node:fs").writeFileSync("rejected.txt", "unexpected")'],
        timeoutMs: 10_000,
      },
      { ...fixture.context, callId: crypto.randomUUID(), modelCallId: crypto.randomUUID() },
    );
    expect(deniedAgain.status).toBe('rejected');
    expect(await doesNotExist(markerPath)).toBe(true);
  });

  it('rejects a stale approval digest and leaves the proposal pending for a valid decision', async () => {
    const proposalPromise = waitForEvent(
      fixture.service,
      fixture.taskId,
      (event) => event.type === 'command_proposed',
    );
    const resultPromise = fixture.service.requestAndExecute(
      'run_tests',
      {
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("never-runs")'],
        timeoutMs: 10_000,
      },
      fixture.context,
    );
    const proposed = commandFrom(await proposalPromise);

    expect(() =>
      fixture.service.decide({
        commandId: proposed.id,
        expectedApprovalDigest: 'stale-digest',
        decision: 'approve',
        rememberExecutable: false,
      }),
    ).toThrow('approval digest is stale');
    expect(fixture.commands.findById(proposed.id)?.status).toBe('pending_approval');

    fixture.service.decide({
      commandId: proposed.id,
      expectedApprovalDigest: proposed.approvalDigest,
      decision: 'reject',
      rememberExecutable: false,
    });
    await expect(resultPromise).resolves.toMatchObject({ status: 'rejected' });
  });

  it('blocks policy-denied commands without creating an approval wait', async () => {
    const result = await fixture.service.requestAndExecute(
      'run_command',
      { executable: 'sudo', args: ['id'], timeoutMs: 10_000 },
      fixture.context,
    );

    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'COMMAND_REJECTED', retryable: false },
    });
    expect(fixture.commands.findById(result.commandId)?.riskLevel).toBe('blocked');
  });

  it('cancels a running command and persists the terminal state', async () => {
    const proposalPromise = waitForEvent(
      fixture.service,
      fixture.taskId,
      (event) => event.type === 'command_proposed',
    );
    const runningPromise = waitForEvent(
      fixture.service,
      fixture.taskId,
      (event) => event.type === 'command_status' && event.command.status === 'running',
    );
    const resultPromise = fixture.service.requestAndExecute(
      'run_command',
      {
        executable: process.execPath,
        args: ['-e', 'setInterval(() => undefined, 1000)'],
        timeoutMs: 30_000,
      },
      fixture.context,
    );
    const proposed = commandFrom(await proposalPromise);
    fixture.service.decide({
      commandId: proposed.id,
      expectedApprovalDigest: proposed.approvalDigest,
      decision: 'approve',
      rememberExecutable: false,
    });
    await runningPromise;

    expect(fixture.service.cancel(proposed.id)).toBe(true);
    await expect(resultPromise).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
    expect(fixture.commands.findById(proposed.id)?.status).toBe('cancelled');
  });

  it('recovers interrupted command records after restart', () => {
    const command = fixture.commands.create({
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      taskId: fixture.taskId,
      modelToolCallId: crypto.randomUUID(),
      toolName: 'run_command',
      executable: process.execPath,
      args: ['--version'],
      cwd: fixture.rootPath,
      timeoutMs: 10_000,
      riskLevel: 'low',
      riskReasons: ['test'],
      approvalDigest: 'digest',
    });

    expect(fixture.commands.recoverInterrupted()).toBe(1);
    expect(fixture.commands.findById(command.id)).toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
  });
});
