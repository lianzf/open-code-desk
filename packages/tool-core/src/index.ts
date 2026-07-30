import { z, type ZodType } from 'zod';

export type PermissionLevel = 'read' | 'write' | 'execute' | 'dangerous';

export interface ToolExecutionContext {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly callId: string;
  readonly modelCallId?: string;
  readonly signal: AbortSignal;
}

export type ToolResult<TOutput> =
  | { readonly ok: true; readonly value: TOutput }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly permissionLevel: PermissionLevel;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly permissionLevel: PermissionLevel;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export class ToolRegistryError extends Error {
  public constructor(
    readonly code: 'TOOL_ALREADY_REGISTERED' | 'TOOL_NOT_REGISTERED',
    message: string,
  ) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}

export class ToolRegistry {
  readonly #tools = new Map<string, AgentTool>();

  public register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): void {
    if (this.#tools.has(tool.name)) {
      throw new ToolRegistryError(
        'TOOL_ALREADY_REGISTERED',
        `Tool "${tool.name}" is already registered.`,
      );
    }
    this.#tools.set(tool.name, tool as AgentTool);
  }

  public get(name: string): AgentTool {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new ToolRegistryError('TOOL_NOT_REGISTERED', `Tool "${name}" is not registered.`);
    }
    return tool;
  }

  public list(): ReadonlyArray<AgentTool> {
    return [...this.#tools.values()];
  }

  public definitions(): ReadonlyArray<ToolDefinition> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      permissionLevel: tool.permissionLevel,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Readonly<Record<string, unknown>>,
    }));
  }
}

export type PermissionDecision =
  | { readonly outcome: 'allow'; readonly reason: string }
  | { readonly outcome: 'require_approval'; readonly reason: string }
  | { readonly outcome: 'deny'; readonly reason: string };

export interface PermissionPolicy {
  decide(tool: AgentTool, context: ToolExecutionContext): PermissionDecision;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  public decide(tool: AgentTool): PermissionDecision {
    if (tool.permissionLevel === 'read') {
      return { outcome: 'allow', reason: 'Read-only workspace tools are allowed by policy.' };
    }
    if (tool.permissionLevel === 'dangerous') {
      return { outcome: 'deny', reason: 'Dangerous tools are denied by default.' };
    }
    return { outcome: 'require_approval', reason: 'Side-effecting tools require user approval.' };
  }
}

export interface ToolExecutionObserver {
  started(tool: AgentTool, input: unknown, context: ToolExecutionContext): Promise<void>;
  completed(
    tool: AgentTool,
    result: ToolResult<unknown>,
    context: ToolExecutionContext,
  ): Promise<void>;
}

export class ToolDispatcher {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionPolicy: PermissionPolicy,
    private readonly observer: ToolExecutionObserver,
  ) {}

  public async execute(
    toolName: string,
    untrustedInput: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult<unknown>> {
    let tool: AgentTool;
    try {
      tool = this.registry.get(toolName);
    } catch {
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `The model requested an unregistered tool: ${toolName}`,
          retryable: false,
        },
      };
    }

    const parsed = tool.inputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'TOOL_INPUT_INVALID',
          message: `Tool ${toolName} input validation failed: ${z.prettifyError(parsed.error)}`,
          retryable: false,
        },
      };
    }

    const decision = this.permissionPolicy.decide(tool, context);
    if (decision.outcome !== 'allow') {
      return {
        ok: false,
        error: {
          code: decision.outcome === 'deny' ? 'TOOL_PERMISSION_DENIED' : 'TOOL_APPROVAL_REQUIRED',
          message: decision.reason,
          retryable: decision.outcome === 'require_approval',
        },
      };
    }

    await this.observer.started(tool, parsed.data, context);
    let result: ToolResult<unknown>;
    try {
      result = { ok: true, value: await tool.execute(parsed.data, context) };
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: context.signal.aborted ? 'CANCELLED' : 'TOOL_EXECUTION_FAILED',
          message: context.signal.aborted
            ? 'Tool execution was cancelled.'
            : error instanceof Error
              ? error.message
              : `Tool ${toolName} failed.`,
          retryable: true,
        },
      };
    }
    await this.observer.completed(tool, result, context);
    return result;
  }
}
