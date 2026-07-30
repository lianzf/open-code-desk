import { randomUUID } from 'node:crypto';

import { AgentStateMachine } from '@open-code-desk/application';
import type { ConversationMessage, MessageToolCall } from '@open-code-desk/domain';
import type { ChatStreamEvent, ChatToolCall } from '@open-code-desk/provider-core';
import {
  DefaultPermissionPolicy,
  ToolDispatcher,
  type PermissionPolicy,
  type ToolRegistry,
  type ToolResult,
} from '@open-code-desk/tool-core';

import type { ConversationRepository } from '../conversations/conversation.repository';
import type { ContextItemRepository } from '../context/context-item.repository';
import type { ProjectRulesService } from '../context/project-rules.service';
import type { FileChangeService } from '../changes/file-change.service';
import type { CommandLifecycleEvent } from '../commands/command-lifecycle';
import type { CommandService } from '../commands/command.service';
import type { ProviderService } from '../providers/provider.service';
import type { AgentTaskRepository } from './agent-task.repository';
import {
  maximumAgentRounds,
  maximumToolCalls,
  parseToolArguments,
  previewOf,
  rejectedToolErrorCodes,
  stringifyToolResult,
  unexpectedError,
  type AccumulatedResponse,
} from './agent-run-support';
import type { AgentEventListener, AgentRunInput } from './agent.types';
import { ConversationContextBuilder } from './conversation-context';
import type { ToolCallRepository } from './tool-call.repository';

export class AgentService {
  readonly #dispatcher: ToolDispatcher;
  readonly #contextBuilder = new ConversationContextBuilder();

  public constructor(
    private readonly providers: ProviderService,
    private readonly conversations: ConversationRepository,
    private readonly tasks: AgentTaskRepository,
    private readonly tools: ToolRegistry,
    private readonly toolCalls: ToolCallRepository,
    private readonly changes?: FileChangeService,
    permissionPolicy: PermissionPolicy = new DefaultPermissionPolicy(),
    private readonly commands?: CommandService,
    private readonly contextItems?: ContextItemRepository,
    private readonly projectRules?: ProjectRulesService,
  ) {
    this.#dispatcher = new ToolDispatcher(tools, permissionPolicy, toolCalls);
  }

  public async run(
    input: AgentRunInput,
    signal: AbortSignal,
    emit: AgentEventListener,
  ): Promise<void> {
    const conversation = this.conversations.findById(input.conversationId);
    if (conversation === null || conversation.workspaceId !== input.workspaceId) {
      throw new Error('Conversation does not belong to the active workspace.');
    }
    if (this.tasks.isActive(input.conversationId)) {
      throw new Error('This conversation already has an active Agent task.');
    }

    const task = this.tasks.create(input.conversationId, input.requestId);
    const machine = new AgentStateMachine();
    let activeAssistantMessage: ConversationMessage | undefined;

    const transition = (status: Parameters<AgentStateMachine['transition']>[0]) => {
      machine.transition(status);
      this.tasks.update(task.id, status);
      emit({ type: 'agent_status', taskId: task.id, status });
    };
    const unsubscribeCommands = this.commands?.subscribe(task.id, (event) => {
      this.consumeCommandEvent(event, machine, transition, emit);
    });

    try {
      transition('analyzing');
      signal.throwIfAborted();
      const profile = await this.providers.getChatProfile(
        input.providerId,
        input.model,
        input.requestId,
        signal,
      );
      this.conversations.updateModel(input.conversationId, input.providerId, profile.model);
      this.conversations.addMessage({
        conversationId: input.conversationId,
        role: 'user',
        content: input.content,
      });
      const projectRules = (await this.projectRules?.load(input.workspaceId, signal)) ?? [];
      transition('planning');

      let executedToolCalls = 0;
      for (let round = 0; round < maximumAgentRounds; round += 1) {
        signal.throwIfAborted();
        const history = this.conversations.listMessages(input.conversationId);
        const context = this.#contextBuilder.build(
          history,
          profile.contextWindow,
          profile.maxOutputTokens,
          [...projectRules, ...(this.contextItems?.list(input.conversationId) ?? [])],
          profile.vision,
        );
        emit({
          type: 'context_built',
          budget: context.budget,
          usedTokens: context.usedTokens,
          droppedMessages: context.droppedMessages,
          summarizedMessages: context.summarizedMessages,
          selectedContextItems: context.selectedContextItems,
          droppedContextItems: context.droppedContextItems,
          truncatedContextItems: context.truncatedContextItems,
        });

        activeAssistantMessage = this.conversations.addMessage({
          conversationId: input.conversationId,
          role: 'assistant',
          content: '',
          reasoning: '',
          modelId: profile.model,
          status: 'streaming',
        });
        emit({ type: 'assistant_message_start', message: activeAssistantMessage });

        const response: AccumulatedResponse = {
          content: '',
          reasoning: '',
          toolCalls: new Map(),
        };
        const stream = await this.providers.createChatStream(
          input.providerId,
          profile.model,
          context.messages,
          `${input.requestId}:${round}`,
          signal,
          profile.toolCalling
            ? this.tools.definitions().map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              }))
            : undefined,
          profile.maxOutputTokens,
        );
        for await (const event of stream) {
          this.consumeProviderEvent(event, activeAssistantMessage.id, response, emit);
        }

        const modelToolCalls: ReadonlyArray<ChatToolCall> = [...response.toolCalls.entries()].map(
          ([id, value]) => ({ id, name: value.name, arguments: value.arguments }),
        );
        activeAssistantMessage =
          this.conversations.updateMessage(activeAssistantMessage.id, {
            content: response.content,
            reasoning: response.reasoning,
            toolCalls: modelToolCalls,
            status: 'complete',
          }) ?? activeAssistantMessage;
        emit({ type: 'assistant_message_end', message: activeAssistantMessage });

        if (modelToolCalls.length === 0) {
          const proposedChanges = this.changes?.findForTask(task.id);
          if (
            proposedChanges !== null &&
            proposedChanges !== undefined &&
            proposedChanges.changes.length > 0 &&
            ['pending_review', 'ready_to_apply'].includes(proposedChanges.changeSet.status)
          ) {
            transition('waiting_for_approval');
            emit({
              type: 'change_set_ready',
              taskId: task.id,
              conversationId: input.conversationId,
              changeSetId: proposedChanges.changeSet.id,
              changeCount: proposedChanges.changes.length,
            });
            return;
          }
          transition('completed');
          emit({ type: 'completed', taskId: task.id });
          return;
        }

        for (const modelToolCall of modelToolCalls) {
          executedToolCalls += 1;
          if (executedToolCalls > maximumToolCalls) {
            throw new Error('The Agent exceeded the maximum number of tool calls.');
          }
          transition('executing_tool');
          await this.executeToolCall(input, task.id, modelToolCall, signal, emit);
        }
        transition('planning');
      }
      throw new Error('The Agent exceeded the maximum number of model rounds.');
    } catch (error) {
      const appError = unexpectedError(error);
      if (activeAssistantMessage?.status === 'streaming') {
        this.conversations.updateMessage(activeAssistantMessage.id, {
          status: appError.code === 'CANCELLED' ? 'cancelled' : 'error',
          error: { ...appError },
        });
      }
      if (appError.code === 'CANCELLED') {
        if (machine.status !== 'cancelled') {
          transition('cancelled');
        }
        emit({ type: 'cancelled', taskId: task.id });
        return;
      }
      if (machine.status !== 'failed') {
        machine.transition('failed');
      }
      this.tasks.update(task.id, 'failed', { error: appError });
      emit({ type: 'agent_status', taskId: task.id, status: 'failed' });
      emit({ type: 'error', taskId: task.id, error: appError });
    } finally {
      unsubscribeCommands?.();
    }
  }

  private consumeCommandEvent(
    event: CommandLifecycleEvent,
    machine: AgentStateMachine,
    transition: (status: Parameters<AgentStateMachine['transition']>[0]) => void,
    emit: AgentEventListener,
  ): void {
    if (event.type === 'command_proposed') {
      if (machine.status !== 'waiting_for_approval') {
        transition('waiting_for_approval');
      }
      emit(event);
      return;
    }
    if (event.type === 'command_output') {
      emit(event);
      return;
    }
    if (event.command.status === 'running') {
      const nextStatus =
        event.command.toolName === 'run_tests' ? 'running_tests' : 'executing_tool';
      if (machine.status !== nextStatus) {
        transition(nextStatus);
      }
    }
    emit(event);
  }

  private consumeProviderEvent(
    event: ChatStreamEvent,
    messageId: string,
    response: AccumulatedResponse,
    emit: AgentEventListener,
  ): void {
    if (event.type === 'text_delta') {
      response.content += event.delta;
      emit({ type: 'text_delta', messageId, delta: event.delta });
    } else if (event.type === 'reasoning_delta') {
      response.reasoning += event.delta;
      emit({ type: 'reasoning_delta', messageId, delta: event.delta });
    } else if (event.type === 'tool_call_start') {
      response.toolCalls.set(event.callId, { name: event.name, arguments: '' });
    } else if (event.type === 'tool_call_delta') {
      const current = response.toolCalls.get(event.callId) ?? { name: '', arguments: '' };
      current.arguments += event.argumentsDelta;
      response.toolCalls.set(event.callId, current);
    } else if (event.type === 'usage') {
      emit({ type: 'usage', messageId, usage: event.usage });
    }
  }

  private async executeToolCall(
    input: AgentRunInput,
    taskId: string,
    modelToolCall: MessageToolCall,
    signal: AbortSignal,
    emit: AgentEventListener,
  ): Promise<void> {
    const callId = randomUUID();
    let parsedInput: unknown;
    try {
      parsedInput = parseToolArguments(modelToolCall.arguments);
    } catch {
      const error = {
        code: 'TOOL_INPUT_INVALID',
        message: `Tool ${modelToolCall.name} arguments are not valid JSON.`,
        retryable: false,
      };
      this.toolCalls.recordRejected(
        {
          id: callId,
          taskId,
          conversationId: input.conversationId,
          toolName: modelToolCall.name,
          untrustedInput: modelToolCall.arguments,
        },
        error,
      );
      emit({
        type: 'tool_status',
        callId,
        modelCallId: modelToolCall.id,
        name: modelToolCall.name,
        status: 'rejected',
        error,
      });
      this.addToolResult(input.conversationId, modelToolCall.id, { ok: false, error });
      return;
    }

    emit({
      type: 'tool_status',
      callId,
      modelCallId: modelToolCall.id,
      name: modelToolCall.name,
      status: 'running',
      input: parsedInput,
    });
    const result = await this.#dispatcher.execute(modelToolCall.name, parsedInput, {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      taskId,
      callId,
      modelCallId: modelToolCall.id,
      signal,
    });
    if (!result.ok && rejectedToolErrorCodes.has(result.error.code)) {
      this.toolCalls.recordRejected(
        {
          id: callId,
          taskId,
          conversationId: input.conversationId,
          toolName: modelToolCall.name,
          untrustedInput: parsedInput,
        },
        result.error,
      );
    }
    emit({
      type: 'tool_status',
      callId,
      modelCallId: modelToolCall.id,
      name: modelToolCall.name,
      status: result.ok
        ? 'completed'
        : result.error.code === 'CANCELLED'
          ? 'cancelled'
          : rejectedToolErrorCodes.has(result.error.code)
            ? 'rejected'
            : 'failed',
      ...(result.ok ? { outputPreview: previewOf(result) } : { error: result.error }),
    });
    this.addToolResult(input.conversationId, modelToolCall.id, result);
  }

  private addToolResult(
    conversationId: string,
    modelCallId: string,
    result: ToolResult<unknown>,
  ): void {
    this.conversations.addMessage({
      conversationId,
      role: 'tool',
      content: stringifyToolResult(result),
      toolCallId: modelCallId,
    });
  }
}
