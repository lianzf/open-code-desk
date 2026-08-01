import { z } from 'zod';

import type { AgentTool, ToolExecutionContext } from '@open-code-desk/tool-core';

import type { ExternalDirectoryService } from '../permissions/external-directory.service';

const grantIdSchema = z.string().uuid();
const relativePathSchema = z.string().max(2_000);

export class ListExternalGrantsTool implements AgentTool {
  public readonly name = 'list_external_grants';
  public readonly description =
    'List user-approved external directory grants for this workspace. Returns opaque grant IDs and directory labels, never credentials.';
  public readonly inputSchema = z.object({}).strict();
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly directories: ExternalDirectoryService) {}

  public execute(_input: unknown, context: ToolExecutionContext): Promise<unknown> {
    return this.directories.listGrants(context.workspaceId);
  }
}

const listExternalDirectorySchema = z
  .object({
    grantId: grantIdSchema,
    path: relativePathSchema.default(''),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

export class ListExternalDirectoryTool implements AgentTool<
  z.infer<typeof listExternalDirectorySchema>,
  unknown
> {
  public readonly name = 'list_external_directory';
  public readonly description =
    'List one user-granted external directory. Every call requires explicit approval and remains confined to the selected grant.';
  public readonly inputSchema = listExternalDirectorySchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly directories: ExternalDirectoryService) {}

  public async execute(
    input: z.infer<typeof listExternalDirectorySchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const entries = await this.directories.listDirectory(
      context.workspaceId,
      input.grantId,
      input.path,
    );
    return {
      grantId: input.grantId,
      path: input.path,
      entries: entries.slice(0, input.limit),
      truncated: entries.length > input.limit,
    };
  }
}

const readExternalFileSchema = z
  .object({
    grantId: grantIdSchema,
    path: relativePathSchema.trim().min(1),
    maxCharacters: z.number().int().min(500).max(100_000).default(30_000),
  })
  .strict();

export class ReadExternalFileTool implements AgentTool<
  z.infer<typeof readExternalFileSchema>,
  unknown
> {
  public readonly name = 'read_external_file';
  public readonly description =
    'Read one UTF-8 file from a user-granted external directory. Every call requires explicit approval; sensitive paths and symlink escapes are denied.';
  public readonly inputSchema = readExternalFileSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly directories: ExternalDirectoryService) {}

  public async execute(
    input: z.infer<typeof readExternalFileSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const file = await this.directories.readFile(context.workspaceId, input.grantId, input.path);
    const content =
      file.content.length <= input.maxCharacters
        ? file.content
        : `${file.content.slice(0, input.maxCharacters)}\n\n… output truncated …`;
    return {
      grantId: input.grantId,
      path: file.relativePath,
      language: file.language,
      content,
      contentHash: file.contentHash,
      truncated: content.length !== file.content.length,
    };
  }
}

export function registerExternalDirectoryTools(
  registry: { register(tool: AgentTool): void },
  directories: ExternalDirectoryService,
): void {
  registry.register(new ListExternalGrantsTool(directories));
  registry.register(new ListExternalDirectoryTool(directories));
  registry.register(new ReadExternalFileTool(directories));
}
