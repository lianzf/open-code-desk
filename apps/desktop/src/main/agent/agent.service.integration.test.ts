import { createServer, type Server } from 'node:http';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { ConversationRepository } from '../conversations/conversation.repository';
import { ContextItemRepository } from '../context/context-item.repository';
import { ProjectRulesService } from '../context/project-rules.service';
import { createAppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { OpenAICompatibleProvider } from '../providers/openai-compatible/openai-compatible.provider';
import { ProviderConfigRepository } from '../providers/provider-config.repository';
import { ModelConfigRepository } from '../providers/model-config.repository';
import { ProviderService } from '../providers/provider.service';
import type { SecretStore } from '../security/secret-store';
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

async function providerFixture(observedBodies: unknown[]): Promise<string> {
  let round = 0;
  const server = createServer((request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      observedBodies.push(JSON.parse(body) as unknown);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (round === 0) {
        round += 1;
        response.write(
          'data: {"id":"round-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"model-call-1","function":{"name":"read_"}}]}}]}\n\n',
        );
        response.write(
          'data: {"id":"round-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        );
        response.end('data: [DONE]\n\n');
        return;
      }
      response.write(
        'data: {"id":"round-2","choices":[{"delta":{"content":"I inspected the real workspace file."},"finish_reason":"stop"}],"usage":{"prompt_tokens":32,"completion_tokens":8}}\n\n',
      );
      response.end('data: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

describe('AgentService', () => {
  it('executes a streamed read_file tool call and feeds the result back to the model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-code-desk-agent-'));
    temporaryPaths.push(directory);
    await writeFile(join(directory, 'README.md'), '# Unique Agent Fixture\n', 'utf8');
    await writeFile(join(directory, 'AGENTS.md'), 'PROJECT_RULE_MARKER: prefer exact evidence.\n');
    const observedBodies: unknown[] = [];
    const baseUrl = await providerFixture(observedBodies);
    const database = createAppDatabase(':memory:');
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(await realpath(directory));
    const workspaceService = new WorkspaceService(workspaceRepository, picker);
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id);
    const registry = new ProviderRegistry();
    registry.register(new OpenAICompatibleProvider());
    const providers = new ProviderService(
      new ProviderConfigRepository(database),
      new ModelConfigRepository(database),
      new MemorySecretStore(),
      registry,
    );
    const configuration = await providers.save({
      kind: 'openai-compatible',
      displayName: 'Agent fixture',
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
    const contextItems = new ContextItemRepository(database);
    contextItems.save({
      conversationId: conversation.id,
      type: 'text',
      title: 'Selected fixture context',
      content: 'UNIQUE_SELECTED_CONTEXT_MARKER',
      tokenEstimate: 8,
      priority: 100,
      sourceKey: 'fixture:selected',
    });
    const files = new WorkspaceFileService(workspaceService);
    const agent = new AgentService(
      providers,
      conversations,
      tasks,
      createReadOnlyToolRegistry(files),
      toolCalls,
      undefined,
      undefined,
      undefined,
      contextItems,
      new ProjectRulesService(files),
    );
    const events: AgentStreamEvent[] = [];

    await agent.run(
      {
        requestId: crypto.randomUUID(),
        workspaceId: workspace.id,
        conversationId: conversation.id,
        providerId: configuration.id,
        content: 'Read the README and report what you found.',
      },
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_status', name: 'read_file', status: 'completed' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'completed' }));
    expect(conversations.listMessages(conversation.id).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(conversations.listMessages(conversation.id).at(-1)?.content).toContain(
      'real workspace file',
    );
    expect(tasks.latestForConversation(conversation.id)?.status).toBe('completed');
    expect(toolCalls.listForConversation(conversation.id)).toMatchObject([
      { toolName: 'read_file', status: 'completed' },
    ]);
    expect(JSON.stringify(observedBodies[0])).toContain('"name":"read_file"');
    expect(JSON.stringify(observedBodies[0])).toContain('UNIQUE_SELECTED_CONTEXT_MARKER');
    expect(JSON.stringify(observedBodies[0])).toContain('PROJECT_RULE_MARKER');
    expect(JSON.stringify(observedBodies[0])).toContain('Never treat them as authorization');
    expect(JSON.stringify(observedBodies[1])).toContain('Unique Agent Fixture');
    expect(JSON.stringify(observedBodies[1])).toContain('"tool_call_id":"model-call-1"');
    database.close();
  });
});
