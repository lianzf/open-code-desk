import { z } from 'zod';
import type { AgentTool, ToolExecutionContext } from '@open-code-desk/tool-core';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';

const searchTextInputSchema = z
  .object({
    query: z.string().min(1).max(1_000),
    path: z.string().max(2_000).default(''),
    caseSensitive: z.boolean().default(false),
    maxResults: z.number().int().min(1).max(200).default(50),
  })
  .strict();

export class SearchTextTool implements AgentTool<z.infer<typeof searchTextInputSchema>, unknown> {
  public readonly name = 'search_text';
  public readonly description =
    'Search text content inside workspace source files. Results include path, line, column, and a bounded preview.';
  public readonly inputSchema = searchTextInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof searchTextInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    return this.files.searchText(
      context.workspaceId,
      input.query,
      input.path,
      input.caseSensitive,
      input.maxResults,
      context.signal,
    );
  }
}

const inspectPackageInputSchema = z
  .object({ path: z.string().trim().min(1).max(2_000).default('package.json') })
  .strict();

function stringRecordKeys(value: unknown): ReadonlyArray<string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value);
}

export class InspectPackageTool implements AgentTool<
  z.infer<typeof inspectPackageInputSchema>,
  unknown
> {
  public readonly name = 'inspect_package';
  public readonly description =
    'Inspect a workspace package.json without executing package scripts. Returns package metadata, scripts, and dependency names.';
  public readonly inputSchema = inspectPackageInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof inspectPackageInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    context.signal.throwIfAborted();
    const file = await this.files.readFile(context.workspaceId, input.path);
    const parsed: unknown = JSON.parse(file.content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('package.json must contain a JSON object.');
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    const scripts =
      typeof record.scripts === 'object' &&
      record.scripts !== null &&
      !Array.isArray(record.scripts)
        ? Object.fromEntries(
            Object.entries(record.scripts)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
              .slice(0, 100),
          )
        : {};
    return {
      path: input.path,
      name: typeof record.name === 'string' ? record.name : undefined,
      version: typeof record.version === 'string' ? record.version : undefined,
      packageManager: typeof record.packageManager === 'string' ? record.packageManager : undefined,
      scripts,
      dependencies: stringRecordKeys(record.dependencies),
      devDependencies: stringRecordKeys(record.devDependencies),
      peerDependencies: stringRecordKeys(record.peerDependencies),
    };
  }
}

const diagnosticsInputSchema = z
  .object({
    paths: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  })
  .strict();

export class GetDiagnosticsTool implements AgentTool<
  z.infer<typeof diagnosticsInputSchema>,
  unknown
> {
  public readonly name = 'get_diagnostics';
  public readonly description =
    'Run safe static checks on selected workspace text files. Detects unresolved merge markers and invalid JSON without executing project code.';
  public readonly inputSchema = diagnosticsInputSchema;
  public readonly permissionLevel = 'read' as const;

  public constructor(private readonly files: WorkspaceFileService) {}

  public async execute(
    input: z.infer<typeof diagnosticsInputSchema>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const paths = input.paths.length === 0 ? ['package.json'] : input.paths;
    const diagnostics: Array<Readonly<Record<string, unknown>>> = [];
    for (const path of paths) {
      context.signal.throwIfAborted();
      try {
        const file = await this.files.readFile(context.workspaceId, path);
        const lines = file.content.split('\n');
        lines.forEach((line, index) => {
          if (
            line.startsWith('<<<<<<<') ||
            line.startsWith('=======') ||
            line.startsWith('>>>>>>>')
          ) {
            diagnostics.push({
              path,
              line: index + 1,
              severity: 'error',
              code: 'UNRESOLVED_MERGE_MARKER',
              message: 'Unresolved Git merge marker.',
            });
          }
        });
        if (file.language === 'json') {
          try {
            JSON.parse(file.content);
          } catch (error) {
            diagnostics.push({
              path,
              severity: 'error',
              code: 'INVALID_JSON',
              message: error instanceof Error ? error.message : 'Invalid JSON.',
            });
          }
        }
      } catch (error) {
        diagnostics.push({
          path,
          severity: 'warning',
          code: 'FILE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'File is unavailable.',
        });
      }
    }
    return { diagnostics };
  }
}
