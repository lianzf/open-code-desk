import { createContextItem } from '@open-code-desk/application';
import type { ContextItem } from '@open-code-desk/domain';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';

const projectRulePaths = [
  'AGENTS.md',
  'CODEX.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
] as const;

export class ProjectRulesService {
  public constructor(private readonly files: Pick<WorkspaceFileService, 'readFile'>) {}

  public async load(workspaceId: string, signal: AbortSignal): Promise<ReadonlyArray<ContextItem>> {
    const rules: ContextItem[] = [];
    for (const relativePath of projectRulePaths) {
      signal.throwIfAborted();
      try {
        const file = await this.files.readFile(workspaceId, relativePath);
        rules.push(
          createContextItem({
            id: `project-rule:${relativePath}`,
            type: 'rules',
            title: relativePath,
            content: file.content,
            priority: 1_000,
          }),
        );
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        // Missing, binary, oversized, or protected rule files are ignored.
      }
    }
    return rules;
  }
}
