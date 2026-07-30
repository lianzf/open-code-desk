import { ToolRegistry } from '@open-code-desk/tool-core';

import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import type { FileChangeService } from '../changes/file-change.service';
import type { CommandService } from '../commands/command.service';
import { registerCommandTools } from './command-tools';
import { registerFileProposalTools } from './file-proposal-tools';
import { ListDirectoryTool, ReadFilesTool, ReadFileTool, SearchFilesTool } from './read-only-tools';
import { GetDiagnosticsTool, InspectPackageTool, SearchTextTool } from './search-and-inspect-tools';

export function createReadOnlyToolRegistry(files: WorkspaceFileService): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ListDirectoryTool(files));
  registry.register(new ReadFileTool(files));
  registry.register(new ReadFilesTool(files));
  registry.register(new SearchFilesTool(files));
  registry.register(new SearchTextTool(files));
  registry.register(new InspectPackageTool(files));
  registry.register(new GetDiagnosticsTool(files));
  return registry;
}

export function createAgentToolRegistry(
  files: WorkspaceFileService,
  changes: FileChangeService,
  commands?: CommandService,
): ToolRegistry {
  const registry = createReadOnlyToolRegistry(files);
  registerFileProposalTools(registry, changes);
  if (commands !== undefined) {
    registerCommandTools(registry, commands);
  }
  return registry;
}
