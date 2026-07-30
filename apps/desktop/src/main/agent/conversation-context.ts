import { ContextBuilder, createContextItem, estimateTokens } from '@open-code-desk/application';
import type { ConversationMessage } from '@open-code-desk/domain';
import type { ChatMessage } from '@open-code-desk/provider-core';

const systemPrompt = `You are OpenCode Desk, an AI coding agent operating on a user-selected workspace.
Use the provided read-only tools to inspect relevant project files before making claims about the code.
Never invent tool results. Never request secrets, credentials, .env files, SSH keys, browser data, or paths outside the workspace.
Do not present a proposed shell command or file edit as already executed. File writes and command execution require separate user approval flows.
Keep tool arguments small and targeted. When enough evidence is available, answer the user's task clearly.`;

export interface ConversationContextResult {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly budget: number;
  readonly usedTokens: number;
  readonly droppedMessages: number;
  readonly summarizedMessages: number;
}

function messageCost(message: ConversationMessage): number {
  const toolCallText = message.toolCalls
    .map((toolCall) => `${toolCall.name}:${toolCall.arguments}`)
    .join('\n');
  return estimateTokens(`${message.role}\n${message.content}\n${toolCallText}`) + 4;
}

function toChatMessage(message: ConversationMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
    ...(message.toolCalls.length === 0 ? {} : { toolCalls: message.toolCalls }),
  };
}

function summaryOf(messages: ReadonlyArray<ConversationMessage>): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-12)
    .map((message) => {
      const label = message.role === 'user' ? 'User' : 'Assistant';
      const singleLine = message.content.replaceAll(/\s+/g, ' ').trim();
      return `- ${label}: ${singleLine.slice(0, 300) || '(tool call or empty response)'}`;
    })
    .join('\n');
}

export class ConversationContextBuilder {
  public constructor(private readonly contextBuilder = new ContextBuilder()) {}

  public build(
    persistedMessages: ReadonlyArray<ConversationMessage>,
    contextWindow: number,
    maximumOutputTokens: number,
  ): ConversationContextResult {
    const availableInput = Math.max(
      512,
      contextWindow - Math.min(maximumOutputTokens, Math.floor(contextWindow / 3)),
    );
    const systemTokens = estimateTokens(systemPrompt);
    const historyBudget = Math.max(256, availableInput - systemTokens - 64);
    const completeMessages = persistedMessages.filter((message) => message.status === 'complete');
    const selectedReversed: ConversationMessage[] = [];
    let remaining = historyBudget;

    for (let index = completeMessages.length - 1; index >= 0; index -= 1) {
      const message = completeMessages[index];
      if (message === undefined) {
        continue;
      }
      const cost = messageCost(message);
      if (cost > remaining) {
        break;
      }
      selectedReversed.push(message);
      remaining -= cost;
    }

    const selected = selectedReversed.reverse();
    const droppedCount = completeMessages.length - selected.length;
    const dropped = completeMessages.slice(0, droppedCount);
    const summary = summaryOf(dropped);
    let summaryMessage: ChatMessage | undefined;
    let summaryTokens = 0;

    if (summary !== '' && remaining >= 32) {
      const result = this.contextBuilder.build(
        [
          createContextItem({
            id: 'conversation-summary',
            type: 'summary',
            title: 'Earlier conversation summary',
            content: summary,
            priority: 100,
          }),
        ],
        {
          budget: remaining,
          minimumTruncationTokens: 16,
          maximumItemTokens: Math.min(2_000, remaining),
        },
      );
      const item = result.items[0];
      if (item !== undefined) {
        summaryTokens = item.tokenEstimate;
        summaryMessage = {
          role: 'system',
          content: `Earlier conversation summary:\n${item.content}`,
        };
      }
    }

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        ...(summaryMessage === undefined ? [] : [summaryMessage]),
        ...selected.map(toChatMessage),
      ],
      budget: availableInput,
      usedTokens:
        systemTokens +
        summaryTokens +
        selected.reduce((total, message) => total + messageCost(message), 0),
      droppedMessages: droppedCount,
      summarizedMessages: summaryMessage === undefined ? 0 : dropped.length,
    };
  }
}
