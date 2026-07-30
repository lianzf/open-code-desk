import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '@open-code-desk/provider-core';

import { ChangeArtifactStore } from '../changes/artifact-store';
import { ChangePathResolver } from '../changes/change-path-resolver';
import { FileChangeRepository } from '../changes/file-change.repository';
import { FileChangeService } from '../changes/file-change.service';
import { ConversationRepository } from '../conversations/conversation.repository';
import { createAppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import { OpenAICompatibleProvider } from '../providers/openai-compatible/openai-compatible.provider';
import { ProviderConfigRepository } from '../providers/provider-config.repository';
import { ProviderService } from '../providers/provider.service';
import type { SecretStore } from '../security/secret-store';
import { ProposalAwarePermissionPolicy } from '../tools/file-proposal-tools';
import { createAgentToolRegistry } from '../tools/register-read-only-tools';
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

async function createProviderFixture(observedBodies: string[]): Promise<string> {
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
        response.write(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"write-1","function":{"name":"update_file","arguments":"{\\"path\\":\\"example.txt\\",\\"content\\":\\"proposed\\\\n\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        );
      } else {
        response.write(
          'data: {"choices":[{"delta":{"content":"The change is ready for review."},"finish_reason":"stop"}]}\n\n',
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

describe('Agent file proposal flow', () => {
  it('stages update_file without touching disk and waits for user approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-agent-change-'));
    temporaryPaths.push(root);
    const workspacePath = join(root, 'workspace');
    await mkdir(workspacePath);
    await writeFile(join(workspacePath, 'example.txt'), 'baseline\n', 'utf8');
    const observedBodies: string[] = [];
    const baseUrl = await createProviderFixture(observedBodies);
    const database = createAppDatabase(':memory:');
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(await realpath(workspacePath));
    const workspaceService = new WorkspaceService(workspaceRepository, picker);
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(workspace.id);
    const registry = new ProviderRegistry();
    registry.register(new OpenAICompatibleProvider());
    const providers = new ProviderService(
      new ProviderConfigRepository(database),
      new MemorySecretStore(),
      registry,
    );
    const configuration = await providers.save({
      kind: 'openai-compatible',
      displayName: 'Proposal fixture',
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
    const changes = new FileChangeService(
      new FileChangeRepository(database),
      new ChangeArtifactStore(join(root, 'artifacts')),
      new ChangePathResolver(workspaceService),
      tasks,
    );
    const agent = new AgentService(
      providers,
      conversations,
      tasks,
      createAgentToolRegistry(new WorkspaceFileService(workspaceService), changes),
      toolCalls,
      changes,
      new ProposalAwarePermissionPolicy(),
    );
    const events: AgentStreamEvent[] = [];

    await agent.run(
      {
        requestId: crypto.randomUUID(),
        workspaceId: workspace.id,
        conversationId: conversation.id,
        providerId: configuration.id,
        content: 'Update example.txt.',
      },
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_status', name: 'update_file', status: 'completed' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'change_set_ready', changeCount: 1 }),
    );
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'completed' }));
    expect(tasks.latestForConversation(conversation.id)?.status).toBe('waiting_for_approval');
    expect(changes.listForConversation(conversation.id)[0]?.changes[0]).toMatchObject({
      operation: 'update',
      filePath: 'example.txt',
      status: 'pending',
    });
    expect(await readFile(join(workspacePath, 'example.txt'), 'utf8')).toBe('baseline\n');
    expect(observedBodies[1]).toContain('No workspace file has been modified');
    database.close();
  });
});
