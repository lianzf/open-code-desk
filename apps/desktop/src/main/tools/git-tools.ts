import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolRegistry } from '@open-code-desk/tool-core';

import type { GitService } from '../git/git.service';

const gitStatusInputSchema = z.object({}).strict();

export class GetGitStatusTool implements AgentTool<z.infer<typeof gitStatusInputSchema>, unknown> {
  public readonly name = 'get_git_status';
  public readonly description =
    'Read the active workspace Git branch and file status without changing the repository.';
  public readonly inputSchema = gitStatusInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly git: GitService) {}

  public async execute(
    _input: z.infer<typeof gitStatusInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const result = await this.git.status(context.workspaceId);
    context.signal.throwIfAborted();
    return result;
  }
}

const gitDiffInputSchema = z
  .object({
    staged: z.boolean().default(false),
    path: z.string().trim().min(1).max(4_096).optional(),
    maxCharacters: z.number().int().min(1_000).max(100_000).default(30_000),
  })
  .strict();

export class GetGitDiffTool implements AgentTool<z.infer<typeof gitDiffInputSchema>, unknown> {
  public readonly name = 'get_git_diff';
  public readonly description =
    'Read a bounded Git diff for the active workspace or one non-sensitive workspace path. External diff programs and text conversion are disabled.';
  public readonly inputSchema = gitDiffInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly git: GitService) {}

  public async execute(
    input: z.infer<typeof gitDiffInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const result = await this.git.diff({
      workspaceId: context.workspaceId,
      staged: input.staged,
      maxCharacters: input.maxCharacters,
      ...(input.path === undefined ? {} : { path: input.path }),
    });
    context.signal.throwIfAborted();
    return result;
  }
}

export function registerGitTools(registry: ToolRegistry, git: GitService): void {
  registry.register(new GetGitStatusTool(git));
  registry.register(new GetGitDiffTool(git));
}
