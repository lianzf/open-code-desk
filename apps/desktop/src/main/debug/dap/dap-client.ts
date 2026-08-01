import { connect, type Socket } from 'node:net';

import { DapFrameParser } from './dap-frame-parser';
import { encodeDapMessage, type DapEventMessage, type DapMessage } from './dap-message';

interface PendingRequest {
  readonly command: string;
  readonly timer: NodeJS.Timeout;
  resolve(body: unknown): void;
  reject(error: Error): void;
}

export class DapRequestError extends Error {
  public constructor(
    public readonly command: string,
    message: string,
  ) {
    super(message);
    this.name = 'DapRequestError';
  }
}

export class DapClient {
  readonly #parser = new DapFrameParser();
  readonly #pending = new Map<number, PendingRequest>();
  readonly #listeners = new Set<(event: DapEventMessage) => void>();
  #reverseRequestHandler:
    ((command: string, argumentsValue: unknown) => Promise<unknown>) | undefined;
  #sequence = 1;
  #closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    socket.once('close', () => this.close(new Error('调试适配器连接已关闭。')));
    socket.once('error', (error) => this.close(error));
  }

  public static async connect(host: string, port: number, timeoutMs = 10_000): Promise<DapClient> {
    const socket = connect({ host, port });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('连接调试适配器超时。'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new DapClient(socket);
  }

  public onEvent(listener: (event: DapEventMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public onReverseRequest(
    handler: (command: string, argumentsValue: unknown) => Promise<unknown>,
  ): () => void {
    this.#reverseRequestHandler = handler;
    return () => {
      if (this.#reverseRequestHandler === handler) this.#reverseRequestHandler = undefined;
    };
  }

  public request<TBody>(
    command: string,
    argumentsValue?: unknown,
    timeoutMs = 15_000,
  ): Promise<TBody> {
    if (this.#closed) {
      return Promise.reject(new DapRequestError(command, '调试适配器连接已关闭。'));
    }
    const seq = this.#sequence;
    this.#sequence += 1;
    const request = {
      seq,
      type: 'request' as const,
      command,
      ...(argumentsValue === undefined ? {} : { arguments: argumentsValue }),
    };
    return new Promise<TBody>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq);
        reject(new DapRequestError(command, `调试请求 ${command} 超时。`));
      }, timeoutMs);
      this.#pending.set(seq, {
        command,
        timer,
        resolve: (body) => resolve(body as TBody),
        reject,
      });
      this.socket.write(encodeDapMessage(request), (error) => {
        if (error !== undefined && error !== null) {
          const pending = this.#pending.get(seq);
          if (pending !== undefined) {
            clearTimeout(pending.timer);
            this.#pending.delete(seq);
            pending.reject(new DapRequestError(command, error.message));
          }
        }
      });
    });
  }

  public waitForEvent(eventName: string, timeoutMs = 15_000): Promise<DapEventMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`等待调试事件 ${eventName} 超时。`));
      }, timeoutMs);
      const unsubscribe = this.onEvent((event) => {
        if (event.event === eventName) {
          clearTimeout(timer);
          unsubscribe();
          resolve(event);
        }
      });
    });
  }

  public dispose(): void {
    this.socket.destroy();
    this.close(new Error('调试客户端已关闭。'));
  }

  private handleData(chunk: Buffer): void {
    try {
      for (const message of this.#parser.push(chunk)) {
        this.handleMessage(message);
      }
    } catch (error) {
      this.socket.destroy();
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(message: DapMessage): void {
    if (message.type === 'response') {
      const pending = this.#pending.get(message.request_seq);
      if (pending === undefined) {
        return;
      }
      clearTimeout(pending.timer);
      this.#pending.delete(message.request_seq);
      if (message.success) {
        pending.resolve(message.body ?? {});
      } else {
        pending.reject(
          new DapRequestError(
            pending.command,
            message.message ?? `调试请求 ${pending.command} 执行失败。`,
          ),
        );
      }
      return;
    }
    if (message.type === 'event') {
      for (const listener of this.#listeners) {
        listener(message);
      }
      return;
    }
    void this.handleReverseRequest(message.seq, message.command, message.arguments);
  }

  private async handleReverseRequest(
    requestSeq: number,
    command: string,
    argumentsValue: unknown,
  ): Promise<void> {
    try {
      if (this.#reverseRequestHandler === undefined) {
        throw new Error(`OpenCode Desk 暂不支持调试器反向请求 ${command}。`);
      }
      const body = await this.#reverseRequestHandler(command, argumentsValue);
      this.sendReverseResponse(requestSeq, command, true, body);
    } catch (error) {
      this.sendReverseResponse(
        requestSeq,
        command,
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private sendReverseResponse(
    requestSeq: number,
    command: string,
    success: boolean,
    responseBody?: unknown,
    message?: string,
  ): void {
    const body = Buffer.from(
      JSON.stringify({
        seq: this.#sequence++,
        type: 'response',
        request_seq: requestSeq,
        success,
        command,
        ...(responseBody === undefined ? {} : { body: responseBody }),
        ...(message === undefined ? {} : { message }),
      }),
      'utf8',
    );
    this.socket.write(
      Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]),
    );
  }

  private close(error: Error): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#listeners.clear();
  }
}
