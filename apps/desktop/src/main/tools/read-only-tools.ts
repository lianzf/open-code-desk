import { z } from 'zod';
import type { AgentTool, ToolExecutionContext } from '@open-code-desk/tool-core';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';

const pathSchema = z.string().max(2_000);
const nonEmptyPathSchema = pathSchema.trim().min(1);

function throwIfCancelled(context: ToolExecutionContext): void {
  context.signal.throwIfAborted();
}

function truncateText(
  content: string,
  maximumCharacters: number,
): {
  readonly content: string;
  readonly truncated: boolean;
} {
  if (content.length <= maximumCharacters) {
    return { content, truncated: false };
  }
  const marker = '\n\n… output truncated …\n\n';
  const available = maximumCharacters - marker.length;
  const head = Math.ceil(available * 0.7);
  return {
    content: `${content.slice(0, head)}${marker}${content.slice(-(available - head))}`,
    truncated: true,
  };
}

const listDirectoryInputSchema = z
  .object({
    path: pathSchema.default(''),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

export class ListDirectoryTool implements AgentTool<
  z.infer<typeof listDirectoryInputSchema>,
  unknown
> {
  public readonly name = 'list_directory';
  public readonly description =
    'List files and directories at a relative path inside the active workspace. Restricted paths are marked and cannot be opened.';
  public readonly inputSchema = listDirectoryInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof listDirectoryInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    throwIfCancelled(context);
    const entries = await this.files.listDirectory(context.workspaceId, input.path);
    throwIfCancelled(context);
    return {
      path: input.path,
      entries: entries.slice(0, input.limit),
      truncated: entries.length > input.limit,
    };
  }
}

const readFileInputSchema = z
  .object({
    path: nonEmptyPathSchema,
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    maxCharacters: z.number().int().min(500).max(100_000).default(30_000),
  })
  .strict()
  .refine(
    (input) =>
      input.startLine === undefined ||
      input.endLine === undefined ||
      input.endLine >= input.startLine,
    { message: 'endLine must be greater than or equal to startLine.' },
  );

async function readBoundedFile(
  files: WorkspaceFileService,
  workspaceId: string,
  path: string,
  options: {
    readonly startLine?: number;
    readonly endLine?: number;
    readonly maxCharacters: number;
  },
): Promise<unknown> {
  const file = await files.readFile(workspaceId, path);
  const lines = file.content.split('\n');
  const startLine = Math.min(options.startLine ?? 1, Math.max(lines.length, 1));
  const endLine = Math.min(options.endLine ?? lines.length, lines.length);
  const selected = lines.slice(startLine - 1, endLine).join('\n');
  const bounded = truncateText(selected, options.maxCharacters);
  return {
    path: file.relativePath,
    language: file.language,
    startLine,
    endLine,
    totalLines: lines.length,
    content: bounded.content,
    truncated: bounded.truncated || startLine > 1 || endLine < lines.length,
    contentHash: file.contentHash,
  };
}

export class ReadFileTool implements AgentTool<z.infer<typeof readFileInputSchema>, unknown> {
  public readonly name = 'read_file';
  public readonly description =
    'Read a UTF-8 text file inside the active workspace. Use line ranges for large files. Sensitive paths and files outside the workspace are denied.';
  public readonly inputSchema = readFileInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof readFileInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    throwIfCancelled(context);
    const result = await readBoundedFile(this.files, context.workspaceId, input.path, {
      ...(input.startLine === undefined ? {} : { startLine: input.startLine }),
      ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
      maxCharacters: input.maxCharacters,
    });
    throwIfCancelled(context);
    return result;
  }
}

const readFilesInputSchema = z
  .object({
    paths: z.array(nonEmptyPathSchema).min(1).max(20),
    maxCharactersPerFile: z.number().int().min(500).max(30_000).default(12_000),
  })
  .strict();

export class ReadFilesTool implements AgentTool<z.infer<typeof readFilesInputSchema>, unknown> {
  public readonly name = 'read_files';
  public readonly description =
    'Read up to 20 UTF-8 workspace files in one call. Individual failures are returned without stopping the remaining reads.';
  public readonly inputSchema = readFilesInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof readFilesInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const results: unknown[] = [];
    for (const path of input.paths) {
      throwIfCancelled(context);
      try {
        results.push(
          await readBoundedFile(this.files, context.workspaceId, path, {
            maxCharacters: input.maxCharactersPerFile,
          }),
        );
      } catch (error) {
        results.push({
          path,
          error: error instanceof Error ? error.message : 'Unable to read file.',
        });
      }
    }
    return { files: results };
  }
}

const searchFilesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();

export class SearchFilesTool implements AgentTool<z.infer<typeof searchFilesInputSchema>, unknown> {
  public readonly name = 'search_files';
  public readonly description =
    'Search workspace file and directory names. This searches paths only, not file contents.';
  public readonly inputSchema = searchFilesInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof searchFilesInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    throwIfCancelled(context);
    const entries = await this.files.searchFiles(context.workspaceId, input.query, input.limit);
    throwIfCancelled(context);
    return { query: input.query, entries };
  }
}
