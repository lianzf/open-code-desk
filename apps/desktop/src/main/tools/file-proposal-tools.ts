import { z } from 'zod';

import type {
  AgentTool,
  PermissionDecision,
  PermissionPolicy,
  ToolExecutionContext,
} from '@open-code-desk/tool-core';

import type { FileChangeAggregate } from '../changes/file-change.repository';
import type { FileChangeService } from '../changes/file-change.service';
import type { PermissionRuleRepository } from '../commands/permission-rule.repository';

const filePathSchema = z.string().trim().min(1).max(2_000);
const contentSchema = z.string().max(2_000_000);

const guardedToolNames = new Set([
  'create_file',
  'update_file',
  'delete_file',
  'move_file',
  'apply_patch',
  'run_command',
  'run_tests',
]);

const externalReadToolNames = new Set(['list_external_directory', 'read_external_file']);

function proposalResult(aggregate: FileChangeAggregate) {
  return {
    changeSetId: aggregate.changeSet.id,
    status: aggregate.changeSet.status,
    changes: aggregate.changes.map((change) => ({
      id: change.id,
      operation: change.operation,
      filePath: change.filePath,
      ...(change.destinationPath === undefined ? {} : { destinationPath: change.destinationPath }),
      status: change.status,
      reviewDigest: change.reviewDigest,
    })),
    message:
      'The proposal is staged in the private review store. No workspace file has been modified.',
  };
}

abstract class ProposalTool<TInput> implements AgentTool<
  TInput,
  ReturnType<typeof proposalResult>
> {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly inputSchema: z.ZodType<TInput>;
  public readonly permissionLevel = 'write' as const;

  public constructor(protected readonly changes: FileChangeService) {}

  public abstract execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ReturnType<typeof proposalResult>>;
}

const createFileInputSchema = z.object({ path: filePathSchema, content: contentSchema }).strict();

export class CreateFileProposalTool extends ProposalTool<z.infer<typeof createFileInputSchema>> {
  public readonly name = 'create_file';
  public readonly description =
    'Propose creating a UTF-8 text file. This only creates a reviewable diff; it never writes the workspace.';
  public readonly inputSchema = createFileInputSchema;

  public async execute(
    input: z.infer<typeof createFileInputSchema>,
    context: ToolExecutionContext,
  ) {
    return proposalResult(await this.changes.proposeCreate(context, input.path, input.content));
  }
}

const updateFileInputSchema = z.object({ path: filePathSchema, content: contentSchema }).strict();

export class UpdateFileProposalTool extends ProposalTool<z.infer<typeof updateFileInputSchema>> {
  public readonly name = 'update_file';
  public readonly description =
    'Propose replacing a UTF-8 text file with complete new content. The user must review and approve the diff.';
  public readonly inputSchema = updateFileInputSchema;

  public async execute(
    input: z.infer<typeof updateFileInputSchema>,
    context: ToolExecutionContext,
  ) {
    return proposalResult(await this.changes.proposeUpdate(context, input.path, input.content));
  }
}

const deleteFileInputSchema = z.object({ path: filePathSchema }).strict();

export class DeleteFileProposalTool extends ProposalTool<z.infer<typeof deleteFileInputSchema>> {
  public readonly name = 'delete_file';
  public readonly description =
    'Propose deleting a workspace text file. Deletion occurs only after explicit diff approval.';
  public readonly inputSchema = deleteFileInputSchema;

  public async execute(
    input: z.infer<typeof deleteFileInputSchema>,
    context: ToolExecutionContext,
  ) {
    return proposalResult(await this.changes.proposeDelete(context, input.path));
  }
}

const moveFileInputSchema = z
  .object({ sourcePath: filePathSchema, destinationPath: filePathSchema })
  .strict();

export class MoveFileProposalTool extends ProposalTool<z.infer<typeof moveFileInputSchema>> {
  public readonly name = 'move_file';
  public readonly description =
    'Propose renaming or moving one workspace text file to a vacant workspace path.';
  public readonly inputSchema = moveFileInputSchema;

  public async execute(input: z.infer<typeof moveFileInputSchema>, context: ToolExecutionContext) {
    return proposalResult(
      await this.changes.proposeRename(context, input.sourcePath, input.destinationPath),
    );
  }
}

const applyPatchInputSchema = z
  .object({ path: filePathSchema, patch: z.string().min(1).max(2_000_000) })
  .strict();

export class ApplyPatchProposalTool extends ProposalTool<z.infer<typeof applyPatchInputSchema>> {
  public readonly name = 'apply_patch';
  public readonly description =
    'Propose applying a unified diff to one UTF-8 workspace file. A clean baseline match and user approval are required.';
  public readonly inputSchema = applyPatchInputSchema;

  public async execute(
    input: z.infer<typeof applyPatchInputSchema>,
    context: ToolExecutionContext,
  ) {
    return proposalResult(await this.changes.proposePatch(context, input.path, input.patch));
  }
}

/**
 * Proposal tools carry write intent but have no workspace side effect. They can
 * run so the user has an artifact to review; the later apply IPC is the actual
 * write authorization boundary.
 */
export class ProposalAwarePermissionPolicy implements PermissionPolicy {
  public constructor(private readonly rules?: PermissionRuleRepository) {}

  public decide(tool: AgentTool, context: ToolExecutionContext): PermissionDecision {
    if (tool.permissionLevel === 'read') {
      if (externalReadToolNames.has(tool.name)) {
        return {
          outcome: 'require_approval',
          reason: 'Every access to a user-granted external directory requires explicit approval.',
        };
      }
      const requiresApproval = this.rules
        ?.list(context.workspaceId)
        .some((rule) => rule.kind === 'require_read_approval');
      if (requiresApproval === true) {
        return {
          outcome: 'require_approval',
          reason: 'Workspace read tools require approval under the current permission settings.',
        };
      }
      return { outcome: 'allow', reason: 'Read-only workspace tool.' };
    }
    if (
      (tool.permissionLevel === 'write' || tool.permissionLevel === 'execute') &&
      guardedToolNames.has(tool.name)
    ) {
      return {
        outcome: 'allow',
        reason:
          'The tool stages an immutable proposal and enforces approval at its side-effect boundary.',
      };
    }
    if (tool.permissionLevel === 'dangerous') {
      return { outcome: 'deny', reason: 'Dangerous tools are denied by default.' };
    }
    return { outcome: 'require_approval', reason: 'A side effect requires explicit approval.' };
  }
}

export function registerFileProposalTools(
  registry: { register(tool: AgentTool): void },
  changes: FileChangeService,
): void {
  registry.register(new CreateFileProposalTool(changes));
  registry.register(new UpdateFileProposalTool(changes));
  registry.register(new DeleteFileProposalTool(changes));
  registry.register(new MoveFileProposalTool(changes));
  registry.register(new ApplyPatchProposalTool(changes));
}
