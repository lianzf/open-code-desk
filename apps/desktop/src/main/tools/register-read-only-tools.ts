import { ToolRegistry } from '@open-code-desk/tool-core';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import type { FileChangeService } from '../changes/file-change.service';
import type { CommandService } from '../commands/command.service';
import type { GitService } from '../git/git.service';
import { registerCommandTools } from './command-tools';
import { registerFileProposalTools } from './file-proposal-tools';
import { ListDirectoryTool, ReadFilesTool, ReadFileTool, SearchFilesTool } from './read-only-tools';
import { GetDiagnosticsTool, InspectPackageTool, SearchTextTool } from './search-and-inspect-tools';
import { registerGitTools } from './git-tools';
import type { ExternalDirectoryService } from '../permissions/external-directory.service';
import { registerExternalDirectoryTools } from './external-directory-tools';

export function createReadOnlyToolRegistry(
  files: WorkspaceFileService,
  git?: GitService,
  externalDirectories?: ExternalDirectoryService,
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ListDirectoryTool(files));
  registry.register(new ReadFileTool(files));
  registry.register(new ReadFilesTool(files));
  registry.register(new SearchFilesTool(files));
  registry.register(new SearchTextTool(files));
  registry.register(new InspectPackageTool(files));
  registry.register(new GetDiagnosticsTool(files));
  if (git !== undefined) {
    registerGitTools(registry, git);
  }
  if (externalDirectories !== undefined) {
    registerExternalDirectoryTools(registry, externalDirectories);
  }
  return registry;
}

export function createAgentToolRegistry(
  files: WorkspaceFileService,
  changes: FileChangeService,
  commands?: CommandService,
  git?: GitService,
  externalDirectories?: ExternalDirectoryService,
): ToolRegistry {
  const registry = createReadOnlyToolRegistry(files, git, externalDirectories);
  registerFileProposalTools(registry, changes);
  if (commands !== undefined) {
    registerCommandTools(registry, commands);
  }
  return registry;
}
