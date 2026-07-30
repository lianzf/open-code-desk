import { ipcMain, type WebContents } from 'electron';
import {
  cancelChatRequestSchema,
  cancelChatResponseSchema,
  chatChannels,
  chatStreamEventSchema,
  startChatRequestSchema,
  startChatResponseSchema,
} from '@open-code-desk/ipc-contracts';

import type { AgentService } from '../agent/agent.service';
import type { AgentStreamEvent } from '../agent/agent.types';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

interface ActiveChat {
  readonly controller: AbortController;
  readonly ownerId: number;
}

export class ChatIpcController {
  readonly #active = new Map<string, ActiveChat>();

  public constructor(private readonly agent: AgentService) {}

  public start(
    sender: WebContents,
    input: ReturnType<typeof startChatRequestSchema.parse>,
  ): string {
    const requestId = input.requestId;
    if (this.#active.has(requestId)) {
      throw new Error('Chat request ID is already active.');
    }
    const controller = new AbortController();
    this.#active.set(requestId, { controller, ownerId: sender.id });

    setImmediate(() => {
      void this.run(sender, input, controller);
    });
    return requestId;
  }

  public cancel(ownerId: number, requestId: string): boolean {
    const active = this.#active.get(requestId);
    if (active === undefined || active.ownerId !== ownerId) {
      return false;
    }
    active.controller.abort(new DOMException('Cancelled by user', 'AbortError'));
    return true;
  }

  public close(): void {
    for (const active of this.#active.values()) {
      active.controller.abort(new DOMException('Application is closing', 'AbortError'));
    }
    this.#active.clear();
  }

  private async run(
    sender: WebContents,
    input: ReturnType<typeof startChatRequestSchema.parse>,
    controller: AbortController,
  ): Promise<void> {
    try {
      await this.agent.run(
        {
          requestId: input.requestId,
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          providerId: input.providerId,
          ...(input.model === undefined ? {} : { model: input.model }),
          content: input.content,
        },
        controller.signal,
        (event) => {
          this.send(sender, input.requestId, event);
        },
      );
    } catch (error) {
      this.send(sender, input.requestId, {
        type: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Unable to start the Agent task.',
          retryable: false,
        },
      });
    } finally {
      this.#active.delete(input.requestId);
    }
  }

  private send(sender: WebContents, requestId: string, event: AgentStreamEvent): void {
    if (sender.isDestroyed()) {
      return;
    }
    sender.send(chatChannels.streamEvent, chatStreamEventSchema.parse({ requestId, event }));
  }
}

export function registerChatIpc(
  options: TrustedRendererOptions,
  controller: ChatIpcController,
): void {
  ipcMain.handle(chatChannels.start, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = startChatRequestSchema.parse(untrustedInput);
    return startChatResponseSchema.parse({
      requestId: controller.start(event.sender, input),
    });
  });

  ipcMain.handle(chatChannels.cancel, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = cancelChatRequestSchema.parse(untrustedInput);
    return cancelChatResponseSchema.parse({
      cancelled: controller.cancel(event.sender.id, input.requestId),
    });
  });
}

export function unregisterChatIpc(controller: ChatIpcController): void {
  controller.close();
  ipcMain.removeHandler(chatChannels.start);
  ipcMain.removeHandler(chatChannels.cancel);
}
