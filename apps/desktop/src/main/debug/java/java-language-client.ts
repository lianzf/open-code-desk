import type { Readable, Writable } from 'node:stream';

interface PendingRequest {
  readonly method: string;
  readonly timer: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

export interface JavaLanguageClientOptions {
  readonly workspaceFolders: ReadonlyArray<{ readonly uri: string; readonly name: string }>;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly maximumBodyBytes?: number;
}

const headerDelimiter = Buffer.from('\r\n\r\n', 'ascii');

export class JavaLanguageClient {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notifications = new Set<(method: string, params: unknown) => void>();
  readonly #maximumBodyBytes: number;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #closed = false;

  public constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly options: JavaLanguageClientOptions,
  ) {
    this.#maximumBodyBytes = options.maximumBodyBytes ?? 16 * 1024 * 1024;
    input.on('data', (chunk: Buffer | string) => {
      this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    input.once('close', () => this.close(new Error('Java language server connection closed.')));
    input.once('error', (error) => this.close(error));
    output.once('error', (error) => this.close(error));
  }

  public request<T>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('Java language server is closed.'));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Java language server request ${method} timed out.`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  public notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  public onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  public dispose(): void {
    this.close(new Error('Java language client disposed.'));
  }

  private handleData(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    try {
      while (this.consumeMessage()) {
        // A single stream chunk may contain more than one LSP frame.
      }
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private consumeMessage(): boolean {
    const headerEnd = this.#buffer.indexOf(headerDelimiter);
    if (headerEnd < 0) {
      if (this.#buffer.length > 8 * 1024) throw new Error('Java LSP header is too large.');
      return false;
    }
    const headers = this.#buffer.subarray(0, headerEnd).toString('ascii');
    const match = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/iu.exec(headers);
    if (match?.[1] === undefined) throw new Error('Java LSP frame has no Content-Length.');
    const contentLength = Number(match[1]);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('Java LSP frame has an invalid Content-Length.');
    }
    if (contentLength > this.#maximumBodyBytes) {
      throw new Error(`Java LSP frame exceeds ${this.#maximumBodyBytes} bytes.`);
    }
    const bodyStart = headerEnd + headerDelimiter.length;
    if (this.#buffer.length < bodyStart + contentLength) return false;
    const body = this.#buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
    this.#buffer = this.#buffer.subarray(bodyStart + contentLength);
    const parsed: unknown = JSON.parse(body);
    if (!isJsonRpcMessage(parsed))
      throw new Error('Java LSP returned an invalid JSON-RPC message.');
    this.handleMessage(parsed);
    return true;
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.method !== undefined && message.id !== undefined) {
      void this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    if (message.method !== undefined) {
      for (const listener of this.#notifications) listener(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(
        new Error(
          `Java language server request ${pending.method} failed: ${message.error.message ?? 'unknown error'}`,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = this.serverRequestResult(method, params);
      this.write({ jsonrpc: '2.0', id, result });
    } catch (error) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private serverRequestResult(method: string, params: unknown): unknown {
    if (method === 'workspace/configuration') {
      const items = configurationItems(params);
      return items.map((item) => configurationValue(this.options.configuration ?? {}, item));
    }
    if (method === 'workspace/workspaceFolders') return this.options.workspaceFolders;
    if (
      method === 'client/registerCapability' ||
      method === 'client/unregisterCapability' ||
      method === 'window/workDoneProgress/create'
    ) {
      return null;
    }
    if (method === 'workspace/applyEdit') {
      return { applied: false, failureReason: 'OpenCode Desk does not apply server edits.' };
    }
    throw new Error(`Unsupported Java language server request: ${method}`);
  }

  private write(message: JsonRpcMessage): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.output.write(
      Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]),
    );
  }

  private close(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#notifications.clear();
  }
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null && (value as JsonRpcMessage).jsonrpc === '2.0';
}

function configurationItems(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (typeof value !== 'object' || value === null) return [];
  const items = (value as Readonly<Record<string, unknown>>).items;
  return Array.isArray(items)
    ? items.filter(
        (item): item is Readonly<Record<string, unknown>> =>
          typeof item === 'object' && item !== null,
      )
    : [];
}

function configurationValue(
  configuration: Readonly<Record<string, unknown>>,
  item: Readonly<Record<string, unknown>>,
): unknown {
  const section = typeof item.section === 'string' ? item.section : '';
  if (section === '') return configuration;
  let value: unknown = configuration;
  for (const segment of section.split('.')) {
    if (typeof value !== 'object' || value === null) return null;
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value ?? null;
}
