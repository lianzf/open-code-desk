import { createServer, type Server } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandExecution } from '@open-code-desk/domain';
import { ProviderRegistry } from '@open-code-desk/provider-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CommandRepository } from '../commands/command.repository';
import { CommandService } from '../commands/command.service';
import { PermissionRuleRepository } from '../commands/permission-rule.repository';
import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { OpenAICompatibleProvider } from '../providers/openai-compatible/openai-compatible.provider';
import { ProviderConfigRepository } from '../providers/provider-config.repository';
import { ModelConfigRepository } from '../providers/model-config.repository';
import { ProviderService } from '../providers/provider.service';
import type { SecretStore } from '../security/secret-store';
import { registerCommandTools } from '../tools/command-tools';
import { ProposalAwarePermissionPolicy } from '../tools/file-proposal-tools';
import { createReadOnlyToolRegistry } from '../tools/register-read-only-tools';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { AgentService } from './agent.service';
import { AgentTaskRepository } from './agent-task.repository';
import type { AgentStreamEvent } from './agent.types';
import { ToolCallRepository } from './tool-call.repository';

const temporaryPaths: string[] = [];
const servers: Server[] = [];
const picker: DirectoryPicker = {
  async pickDirectory() {
    return null;
  },
};

class MemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  public async set(ref: string, value: string): Promise<void> {
    this.#values.set(ref, value);
  }

  public async get(ref: string): Promise<string | null> {
    return this.#values.get(ref) ?? null;
  }

  public async has(ref: string): Promise<boolean> {
    return this.#values.has(ref);
  }

  public async delete(ref: string): Promise<boolean> {
    return this.#values.delete(ref);
  }
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

async function commandProviderFixture(observedBodies: string[]): Promise<string> {
  let round = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      observedBodies.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (round === 0) {
        round += 1;
        const argumentsText = JSON.stringify({
          executable: process.execPath,
          args: ['-e', 'process.stdout.write("agent-command-output")'],
          timeoutMs: 10_000,
        });
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'command-call-1',
                      function: { name: 'run_tests', arguments: argumentsText },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })}\n\n`,
        );
      } else {
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: { content: 'Tests passed after the approved command.' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

describe('Agent command approval loop', () => {
  it('waits for approval, streams test output, and feeds the persisted result back to the model', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-agent-command-'));
    temporaryPaths.push(rootPath);
    const observedBodies: string[] = [];
    const baseUrl = await commandProviderFixture(observedBodies);
    const database = createAppDatabase(':memory:');
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(await realpath(rootPath));
    const workspaceService = new WorkspaceService(workspaceRepository, picker);
    await workspaceService.openRecent(workspace.id);
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id);
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(new OpenAICompatibleProvider());
    const providers = new ProviderService(
      new ProviderConfigRepository(database),
      new ModelConfigRepository(database),
      new MemorySecretStore(),
      providerRegistry,
    );
    const configuration = await providers.save({
      kind: 'openai-compatible',
      displayName: 'Command fixture',
      baseUrl,
      defaultModel: 'fixture-model',
      contextWindow: 16_000,
      toolCalling: true,
      vision: false,
      streaming: true,
      customHeaders: [],
    });
    const tasks = new AgentTaskRepository(database);
    const toolCalls = new ToolCallRepository(database);
    const commandRepository = new CommandRepository(database);
    const commands = new CommandService(
      commandRepository,
      new PermissionRuleRepository(database),
      workspaceService,
    );
    const tools = createReadOnlyToolRegistry(new WorkspaceFileService(workspaceService));
    registerCommandTools(tools, commands);
    const agent = new AgentService(
      providers,
      conversations,
      tasks,
      tools,
      toolCalls,
      undefined,
      new ProposalAwarePermissionPolicy(),
      commands,
    );
    const events: AgentStreamEvent[] = [];
    let resolveProposal: ((command: CommandExecution) => void) | undefined;
    const proposalPromise = new Promise<CommandExecution>((resolve) => {
      resolveProposal = resolve;
    });
    const runPromise = agent.run(
      {
        requestId: crypto.randomUUID(),
        workspaceId: workspace.id,
        conversationId: conversation.id,
        providerId: configuration.id,
        content: 'Run the project tests.',
      },
      new AbortController().signal,
      (event) => {
        events.push(event);
        if (event.type === 'command_proposed') {
          resolveProposal?.(event.command);
        }
      },
    );

    const proposal = await proposalPromise;
    expect(proposal.status).toBe('pending_approval');
    expect(tasks.latestForConversation(conversation.id)?.status).toBe('waiting_for_approval');
    commands.decide({
      commandId: proposal.id,
      expectedApprovalDigest: proposal.approvalDigest,
      decision: 'approve',
      rememberExecutable: false,
    });
    await runPromise;

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent_status', status: 'waiting_for_approval' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent_status', status: 'running_tests' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'command_output',
        commandId: proposal.id,
        chunk: expect.stringContaining('agent-command-output'),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'completed' }));
    expect(commandRepository.findById(proposal.id)).toMatchObject({
      status: 'completed',
      exitCode: 0,
      outputTail: expect.stringContaining('agent-command-output'),
    });
    expect(toolCalls.listForConversation(conversation.id)).toMatchObject([
      { toolName: 'run_tests', status: 'completed' },
    ]);
    expect(observedBodies[1]).toContain('"tool_call_id":"command-call-1"');
    expect(observedBodies[1]).toContain('agent-command-output');
    expect(conversations.listMessages(conversation.id).at(-1)?.content).toContain('Tests passed');
    expect(tasks.latestForConversation(conversation.id)?.status).toBe('completed');

    commands.close();
    database.close();
  });
});
