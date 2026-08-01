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
import type { DapClient } from '../dap/dap-client';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from './dap-values';
import { mapVariable } from './node-debug-launch';

export class NodeDebugDataAccess {
  readonly #threadClients = new Map<number, DapClient>();
  readonly #frameClients = new Map<number, DapClient>();
  readonly #referenceClients = new Map<number, DapClient>();

  public constructor(
    private readonly rootClient: DapClient,
    private readonly clients: () => Iterable<DapClient>,
    private readonly workspaceRoot: string,
    private readonly sensitiveValues: ReadonlyArray<string>,
  ) {}

  public rememberThread(threadId: number, client: DapClient): void {
    this.#threadClients.set(threadId, client);
  }

  public threadClient(threadId: number): DapClient {
    return this.#threadClients.get(threadId) ?? this.rootClient;
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
          this.rememberThread(id, client);
          if (!all.some((item) => item.id === id)) all.push({ id, name });
        }
      }
    }
    return all;
  }

  public async stackTrace(threadId: number): Promise<ReadonlyArray<DebugStackFrame>> {
    const client = this.threadClient(threadId);
    const body = asRecord(
      await client.request<unknown>('stackTrace', { threadId, startFrame: 0, levels: 200 }),
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
      this.#frameClients.set(id, client);
      const source = asRecord(frame.source);
      const sourceName = stringValue(source, 'name');
      const relativePath = this.safeRelativePath(stringValue(source, 'path'));
      return [
        {
          id,
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
    const body = asRecord(await client.request<unknown>('scopes', { frameId }));
    return asArray(body.scopes).flatMap((entry) => {
      const scope = asRecord(entry);
      const name = stringValue(scope, 'name');
      const reference = numberValue(scope, 'variablesReference');
      if (name === undefined || reference === undefined) return [];
      this.#referenceClients.set(reference, client);
      return [
        {
          name,
          variablesReference: reference,
          expensive: booleanValue(scope, 'expensive') ?? false,
        },
      ];
    });
  }

  public async variables(reference: number): Promise<ReadonlyArray<DebugVariable>> {
    const client = this.#referenceClients.get(reference) ?? this.rootClient;
    const body = asRecord(
      await client.request<unknown>('variables', {
        variablesReference: reference,
        start: 0,
        count: 10_000,
      }),
    );
    const variables = asArray(body.variables)
      .flatMap((entry) => mapVariable(entry))
      .map((variable) => ({
        ...variable,
        value: redactSensitiveText(variable.value, this.sensitiveValues),
      }));
    for (const variable of variables) {
      if (variable.variablesReference > 0) {
        this.#referenceClients.set(variable.variablesReference, client);
      }
    }
    return variables;
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
        ...(frameId === undefined ? {} : { frameId }),
      }),
    );
    const reference = numberValue(body, 'variablesReference') ?? 0;
    if (reference > 0) this.#referenceClients.set(reference, client);
    const type = stringValue(body, 'type');
    return {
      expression,
      result: redactSensitiveText(stringValue(body, 'result') ?? '', this.sensitiveValues),
      ...(type === undefined ? {} : { type }),
      variablesReference: reference,
    };
  }

  public async exceptionInfo(
    threadId: number,
    supported: boolean,
  ): Promise<DebugExceptionInfo | undefined> {
    if (!supported) return undefined;
    const body = asRecord(
      await this.threadClient(threadId).request<unknown>('exceptionInfo', { threadId }),
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
}
