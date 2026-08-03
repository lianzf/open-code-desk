import { isAbsolute, relative, resolve } from 'node:path';

import type {
  DebugEvaluationResult,
  DebugExceptionInfo,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
} from '@open-code-desk/domain';

import { isPathInside } from '../../filesystem/path-policy';
import { redactSensitiveText } from '../../security/sensitive-text';
import type { DapClient } from './dap-client';
import {
  asArray,
  asRecord,
  booleanValue,
  mapDapVariable,
  numberValue,
  stringValue,
} from './dap-values';

/** Shared safe projection for DAP threads, frames, scopes, values and exceptions. */
export class DapDataAccess {
  readonly #threadClients = new Map<number, DapClient>();
  readonly #threadAdapterIds = new Map<number, number>();
  readonly #threadPublicIds = new Map<DapClient, Map<number, number>>();
  readonly #frameClients = new Map<number, DapClient>();
  readonly #frameAdapterIds = new Map<number, number>();
  readonly #framePublicIds = new Map<DapClient, Map<number, number>>();
  readonly #referenceClients = new Map<number, DapClient>();
  readonly #referenceAdapterIds = new Map<number, number>();
  readonly #referencePublicIds = new Map<DapClient, Map<number, number>>();
  #nextSyntheticId = 2_000_000_000;

  public constructor(
    private readonly rootClient: DapClient,
    private readonly clients: () => Iterable<DapClient>,
    private readonly workspaceRoot: string,
    private readonly sensitiveValues: ReadonlyArray<string>,
  ) {}

  public rememberThread(threadId: number, client: DapClient): number {
    return this.rememberAdapterId(
      threadId,
      client,
      this.#threadClients,
      this.#threadAdapterIds,
      this.#threadPublicIds,
    );
  }

  public threadClient(threadId: number): DapClient {
    return this.#threadClients.get(threadId) ?? this.rootClient;
  }

  public threadAdapterId(threadId: number): number {
    return this.#threadAdapterIds.get(threadId) ?? threadId;
  }

  public async threads(): Promise<ReadonlyArray<DebugThread>> {
    const all: DebugThread[] = [];
    for (const client of this.clients()) {
      const body = asRecord(await client.request<unknown>('threads'));
      for (const entry of asArray(body.threads)) {
        const thread = asRecord(entry);
        const id = numberValue(thread, 'id');
        const name = stringValue(thread, 'name');
        if (id !== undefined && name !== undefined) {
          const publicId = this.rememberThread(id, client);
          if (!all.some((item) => item.id === publicId)) all.push({ id: publicId, name });
        }
      }
    }
    return all;
  }

  public async stackTrace(threadId: number): Promise<ReadonlyArray<DebugStackFrame>> {
    const client = this.threadClient(threadId);
    const body = asRecord(
      await client.request<unknown>('stackTrace', {
        threadId: this.threadAdapterId(threadId),
        startFrame: 0,
        levels: 200,
      }),
    );
    return asArray(body.stackFrames).flatMap((entry) => {
      const frame = asRecord(entry);
      const id = numberValue(frame, 'id');
      const name = stringValue(frame, 'name');
      const line = numberValue(frame, 'line');
      const column = numberValue(frame, 'column');
      if (id === undefined || name === undefined || line === undefined || column === undefined) {
        return [];
      }
      const publicId = this.rememberAdapterId(
        id,
        client,
        this.#frameClients,
        this.#frameAdapterIds,
        this.#framePublicIds,
      );
      const source = asRecord(frame.source);
      const sourceName = stringValue(source, 'name');
      const relativePath = this.safeRelativePath(stringValue(source, 'path'));
      return [
        {
          id: publicId,
          name,
          ...(sourceName === undefined ? {} : { sourceName }),
          ...(relativePath === undefined ? {} : { relativePath }),
          line,
          column,
        },
      ];
    });
  }

  public async scopes(frameId: number): Promise<ReadonlyArray<DebugScope>> {
    const client = this.#frameClients.get(frameId) ?? this.rootClient;
    const body = asRecord(
      await client.request<unknown>('scopes', {
        frameId: this.#frameAdapterIds.get(frameId) ?? frameId,
      }),
    );
    return asArray(body.scopes).flatMap((entry) => {
      const scope = asRecord(entry);
      const name = stringValue(scope, 'name');
      const reference = numberValue(scope, 'variablesReference');
      if (name === undefined || reference === undefined) return [];
      const publicReference =
        reference <= 0
          ? reference
          : this.rememberAdapterId(
              reference,
              client,
              this.#referenceClients,
              this.#referenceAdapterIds,
              this.#referencePublicIds,
            );
      return [
        {
          name,
          variablesReference: publicReference,
          expensive: booleanValue(scope, 'expensive') ?? false,
        },
      ];
    });
  }

  public async variables(reference: number): Promise<ReadonlyArray<DebugVariable>> {
    const client = this.#referenceClients.get(reference) ?? this.rootClient;
    const body = asRecord(
      await client.request<unknown>('variables', {
        variablesReference: this.#referenceAdapterIds.get(reference) ?? reference,
        start: 0,
        count: 10_000,
      }),
    );
    return asArray(body.variables)
      .flatMap((entry) => mapDapVariable(entry))
      .map((variable) => ({
        ...variable,
        value: redactSensitiveText(variable.value, this.sensitiveValues),
        variablesReference:
          variable.variablesReference <= 0
            ? variable.variablesReference
            : this.rememberAdapterId(
                variable.variablesReference,
                client,
                this.#referenceClients,
                this.#referenceAdapterIds,
                this.#referencePublicIds,
              ),
      }));
  }

  public async evaluate(
    expression: string,
    frameId: number | undefined,
    context: 'watch' | 'repl' | 'hover',
  ): Promise<DebugEvaluationResult> {
    const client =
      frameId === undefined
        ? this.rootClient
        : (this.#frameClients.get(frameId) ?? this.rootClient);
    const body = asRecord(
      await client.request<unknown>('evaluate', {
        expression,
        context,
        ...(frameId === undefined
          ? {}
          : { frameId: this.#frameAdapterIds.get(frameId) ?? frameId }),
      }),
    );
    const reference = numberValue(body, 'variablesReference') ?? 0;
    const publicReference =
      reference <= 0
        ? reference
        : this.rememberAdapterId(
            reference,
            client,
            this.#referenceClients,
            this.#referenceAdapterIds,
            this.#referencePublicIds,
          );
    const type = stringValue(body, 'type');
    return {
      expression,
      result: redactSensitiveText(stringValue(body, 'result') ?? '', this.sensitiveValues),
      ...(type === undefined ? {} : { type }),
      variablesReference: publicReference,
    };
  }

  public async exceptionInfo(
    threadId: number,
    supported: boolean,
  ): Promise<DebugExceptionInfo | undefined> {
    if (!supported) return undefined;
    const body = asRecord(
      await this.threadClient(threadId).request<unknown>('exceptionInfo', {
        threadId: this.threadAdapterId(threadId),
      }),
    );
    const exceptionId = stringValue(body, 'exceptionId');
    if (exceptionId === undefined) return undefined;
    const details = asRecord(body.details);
    const redact = (value: string | undefined) =>
      value === undefined ? undefined : redactSensitiveText(value, this.sensitiveValues);
    const redactedExceptionId = redactSensitiveText(exceptionId, this.sensitiveValues);
    const separatorIndex = redactedExceptionId.indexOf(':');
    const description = redact(stringValue(body, 'description'));
    const breakMode = stringValue(body, 'breakMode');
    const typeName =
      redact(stringValue(details, 'typeName')) ??
      (separatorIndex > 0 ? redactedExceptionId.slice(0, separatorIndex).trim() : undefined);
    const message =
      redact(stringValue(details, 'message')) ??
      (separatorIndex > 0 ? redactedExceptionId.slice(separatorIndex + 1).trim() : undefined);
    const stackTrace = redact(stringValue(details, 'stackTrace'));
    return {
      exceptionId: redactedExceptionId,
      ...(description === undefined ? {} : { description }),
      ...(breakMode === undefined ? {} : { breakMode }),
      ...(typeName === undefined ? {} : { typeName }),
      ...(message === undefined ? {} : { message }),
      ...(stackTrace === undefined ? {} : { stackTrace }),
    };
  }

  private safeRelativePath(sourcePath: string | undefined): string | undefined {
    if (sourcePath === undefined || !isAbsolute(sourcePath)) return undefined;
    const absolute = resolve(sourcePath);
    return isPathInside(this.workspaceRoot, absolute)
      ? relative(this.workspaceRoot, absolute).replaceAll('\\', '/')
      : undefined;
  }

  private rememberAdapterId(
    adapterId: number,
    client: DapClient,
    clientByPublicId: Map<number, DapClient>,
    adapterIdByPublicId: Map<number, number>,
    publicIdsByClient: Map<DapClient, Map<number, number>>,
  ): number {
    if (client === this.rootClient) {
      clientByPublicId.set(adapterId, client);
      adapterIdByPublicId.set(adapterId, adapterId);
      return adapterId;
    }
    let publicIds = publicIdsByClient.get(client);
    if (publicIds === undefined) {
      publicIds = new Map();
      publicIdsByClient.set(client, publicIds);
    }
    const existing = publicIds.get(adapterId);
    if (existing !== undefined) return existing;
    const publicId = this.#nextSyntheticId++;
    publicIds.set(adapterId, publicId);
    clientByPublicId.set(publicId, client);
    adapterIdByPublicId.set(publicId, adapterId);
    return publicId;
  }
}
