import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull, like, max } from 'drizzle-orm';
import type {
  Conversation,
  ConversationMessage,
  MessageRole,
  MessageStatus,
  MessageToolCall,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { conversations, messages } from '../database/schema';

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

export interface AddMessageInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly reasoning?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: ReadonlyArray<MessageToolCall>;
  readonly modelId?: string;
  readonly status?: MessageStatus;
}

export interface UpdateMessageInput {
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCalls?: ReadonlyArray<MessageToolCall>;
  readonly status?: MessageStatus;
  readonly error?: Readonly<Record<string, unknown>>;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    ...(row.providerConfigId === null ? {} : { providerConfigId: row.providerConfigId }),
    ...(row.modelId === null ? {} : { modelId: row.modelId }),
    status: row.status === 'archived' ? 'archived' : 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageRole,
    content: row.content,
    reasoning: row.reasoning,
    ...(row.toolCallId === null ? {} : { toolCallId: row.toolCallId }),
    toolCalls: row.toolCalls,
    sequence: row.sequence,
    ...(row.modelId === null ? {} : { modelId: row.modelId }),
    status: row.status as MessageStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function defaultTitle(): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `新会话 ${formatter.format(new Date())}`;
}

export class ConversationRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(
    workspaceId: string,
    options: {
      readonly title?: string;
      readonly providerConfigId?: string;
      readonly modelId?: string;
    } = {},
  ): Conversation {
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(conversations)
      .values({
        id: randomUUID(),
        workspaceId,
        title: options.title?.trim() || defaultTitle(),
        providerConfigId: options.providerConfigId ?? null,
        modelId: options.modelId ?? null,
        status: 'active',
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return toConversation(row);
  }

  public findById(conversationId: string): Conversation | null {
    const row = this.database.orm
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .get();
    return row === undefined ? null : toConversation(row);
  }

  public list(workspaceId: string, query = '', limit = 100): ReadonlyArray<Conversation> {
    const trimmedQuery = query.trim();
    const condition =
      trimmedQuery === ''
        ? and(eq(conversations.workspaceId, workspaceId), isNull(conversations.deletedAt))
        : and(
            eq(conversations.workspaceId, workspaceId),
            isNull(conversations.deletedAt),
            like(conversations.title, `%${trimmedQuery}%`),
          );
    return this.database.orm
      .select()
      .from(conversations)
      .where(condition)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .all()
      .map(toConversation);
  }

  public rename(conversationId: string, title: string): Conversation | null {
    const normalizedTitle = title.trim();
    if (normalizedTitle === '') {
      throw new Error('Conversation title cannot be empty.');
    }
    const row = this.database.orm
      .update(conversations)
      .set({ title: normalizedTitle, updatedAt: new Date().toISOString() })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .returning()
      .get();
    return row === undefined ? null : toConversation(row);
  }

  public updateModel(
    conversationId: string,
    providerConfigId: string,
    modelId: string,
  ): Conversation | null {
    const row = this.database.orm
      .update(conversations)
      .set({
        providerConfigId,
        modelId,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .returning()
      .get();
    return row === undefined ? null : toConversation(row);
  }

  public softDelete(conversationId: string): boolean {
    const now = new Date().toISOString();
    const row = this.database.orm
      .update(conversations)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .returning({ id: conversations.id })
      .get();
    return row !== undefined;
  }

  public addMessage(input: AddMessageInput): ConversationMessage {
    const nextSequence =
      this.database.orm
        .select({ value: max(messages.sequence) })
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .get()?.value ?? 0;
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(messages)
      .values({
        id: input.id ?? randomUUID(),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        reasoning: input.reasoning ?? '',
        toolCallId: input.toolCallId ?? null,
        toolCalls: input.toolCalls ?? [],
        sequence: nextSequence + 1,
        modelId: input.modelId ?? null,
        status: input.status ?? 'complete',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    this.touch(input.conversationId);
    return toMessage(row);
  }

  public updateMessage(messageId: string, input: UpdateMessageInput): ConversationMessage | null {
    const values: Partial<typeof messages.$inferInsert> = {
      updatedAt: new Date().toISOString(),
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
      ...(input.toolCalls === undefined ? {} : { toolCalls: input.toolCalls }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.error === undefined ? {} : { error: input.error }),
    };
    const row = this.database.orm
      .update(messages)
      .set(values)
      .where(eq(messages.id, messageId))
      .returning()
      .get();
    if (row === undefined) {
      return null;
    }
    this.touch(row.conversationId);
    return toMessage(row);
  }

  public listMessages(conversationId: string): ReadonlyArray<ConversationMessage> {
    return this.database.orm
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.sequence)
      .all()
      .map(toMessage);
  }

  private touch(conversationId: string): void {
    this.database.orm
      .update(conversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(conversations.id, conversationId))
      .run();
  }
}
