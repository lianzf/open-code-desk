import type { ConversationDetail, CreateConversationRequest } from '@open-code-desk/ipc-contracts';

import type { AgentTaskRepository } from '../agent/agent-task.repository';
import type { ToolCallRepository } from '../agent/tool-call.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { ConversationRepository } from './conversation.repository';

function requireValue<T>(value: T | null, message: string): T {
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

function markdownHeading(role: 'system' | 'user' | 'assistant' | 'tool'): string {
  const labels = {
    system: 'System',
    user: 'User',
    assistant: 'Assistant',
    tool: 'Tool result',
  } as const;
  return `## ${labels[role]}`;
}

export class ConversationService {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly tasks: AgentTaskRepository,
    private readonly toolCalls: ToolCallRepository,
    private readonly workspaces: WorkspaceService,
  ) {}

  public list(workspaceId: string, query: string) {
    return this.conversations.list(workspaceId, query);
  }

  public async create(input: CreateConversationRequest) {
    await this.workspaces.getById(input.workspaceId);
    return this.conversations.create(input.workspaceId, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.providerConfigId === undefined ? {} : { providerConfigId: input.providerConfigId }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    });
  }

  public get(conversationId: string): ConversationDetail {
    const conversation = requireValue(
      this.conversations.findById(conversationId),
      'Conversation not found.',
    );
    return {
      conversation,
      messages: this.conversations.listMessages(conversationId).map((message) => ({
        ...message,
        toolCalls: [...message.toolCalls],
      })),
      latestTask: this.tasks.latestForConversation(conversationId),
      toolCalls: this.toolCalls.listForConversation(conversationId).map((toolCall) => ({
        ...toolCall,
      })),
    };
  }

  public rename(conversationId: string, title: string) {
    return requireValue(
      this.conversations.rename(conversationId, title),
      'Conversation not found.',
    );
  }

  public delete(conversationId: string): true {
    if (this.tasks.isActive(conversationId)) {
      throw new Error('Stop the active Agent task before deleting this conversation.');
    }
    if (!this.conversations.softDelete(conversationId)) {
      throw new Error('Conversation not found.');
    }
    return true;
  }

  public toMarkdown(conversationId: string): { readonly title: string; readonly markdown: string } {
    const detail = this.get(conversationId);
    const sections = detail.messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        const reasoning =
          message.reasoning === ''
            ? ''
            : `\n\n<details><summary>Reasoning</summary>\n\n${message.reasoning}\n\n</details>`;
        const toolName =
          message.toolCalls.length === 0
            ? ''
            : `\n\n_Tools requested: ${message.toolCalls
                .map((toolCall) => `\`${toolCall.name}\``)
                .join(', ')}_`;
        return `${markdownHeading(message.role)}\n\n${message.content}${reasoning}${toolName}`;
      });
    return {
      title: detail.conversation.title,
      markdown: `# ${detail.conversation.title}\n\n${sections.join('\n\n---\n\n')}\n`,
    };
  }
}
