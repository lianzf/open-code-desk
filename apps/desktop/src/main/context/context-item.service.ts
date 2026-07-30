import { estimateTokens } from '@open-code-desk/application';
import type { ContextItem } from '@open-code-desk/domain';

import type { ConversationRepository } from '../conversations/conversation.repository';
import type { ContextItemRepository } from './context-item.repository';

export interface SaveConversationContextInput {
  readonly conversationId: string;
  readonly type: ContextItem['type'];
  readonly title: string;
  readonly content: string;
  readonly priority: number;
  readonly sourceKey?: string;
}

export class ContextItemService {
  public constructor(
    private readonly repository: ContextItemRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  public list(conversationId: string) {
    this.requireConversation(conversationId);
    return this.repository.list(conversationId);
  }

  public save(input: SaveConversationContextInput) {
    this.requireConversation(input.conversationId);
    return this.repository.save({
      conversationId: input.conversationId,
      type: input.type,
      title: input.title.trim(),
      content: input.content,
      tokenEstimate: estimateTokens(input.content),
      priority: input.priority,
      ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
    });
  }

  public delete(conversationId: string, contextItemId: string): boolean {
    this.requireConversation(conversationId);
    return this.repository.delete(conversationId, contextItemId);
  }

  private requireConversation(conversationId: string): void {
    if (this.conversations.findById(conversationId) === null) {
      throw new Error('Conversation not found.');
    }
  }
}
