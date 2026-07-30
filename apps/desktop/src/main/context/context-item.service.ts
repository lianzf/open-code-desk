import { estimateTokens } from '@open-code-desk/application';
import type { ContextItem } from '@open-code-desk/domain';

import type { ConversationRepository } from '../conversations/conversation.repository';
import type { ContextItemRepository } from './context-item.repository';
import type { ContextImagePicker } from './image-context-picker';

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
    private readonly imagePicker?: ContextImagePicker,
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

  public async pickImage(conversationId: string) {
    this.requireConversation(conversationId);
    if (this.imagePicker === undefined) {
      throw new Error('当前环境不支持选择图片。');
    }
    const selected = await this.imagePicker.pick();
    if (selected === null) {
      return null;
    }
    return this.repository.save({
      conversationId,
      type: 'image',
      title: selected.title,
      content: selected.content,
      tokenEstimate: 1_000,
      priority: 85,
      sourceKey: selected.sourceKey,
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
