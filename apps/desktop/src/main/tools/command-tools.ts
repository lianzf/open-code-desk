import { z } from 'zod';

import type { AgentTool, ToolExecutionContext } from '@open-code-desk/tool-core';

import type { CommandService, CommandToolOutput } from '../commands/command.service';

const commandInputSchema = z
  .object({
    executable: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine((value) => !value.includes('\0'), {
        message: 'Executable cannot contain a null byte.',
      }),
    args: z
      .array(
        z
          .string()
          .max(8_000)
          .refine((value) => !value.includes('\0'), {
            message: 'Arguments cannot contain a null byte.',
          }),
      )
      .max(128)
      .default([]),
    cwd: z.string().max(2_000).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  })
  .strict();

type CommandInput = z.infer<typeof commandInputSchema>;

abstract class CommandTool implements AgentTool<CommandInput, CommandToolOutput> {
  public abstract readonly name: 'run_command' | 'run_tests';
  public abstract readonly description: string;
  public readonly inputSchema = commandInputSchema;
  public readonly permissionLevel = 'execute' as const;

  public constructor(protected readonly commands: CommandService) {}

  public execute(input: CommandInput, context: ToolExecutionContext): Promise<CommandToolOutput> {
    return this.commands.requestAndExecute(this.name, input, context);
  }
}

export class RunCommandTool extends CommandTool {
  public readonly name = 'run_command';
  public readonly description =
    'Propose one structured executable invocation. It pauses for user approval, runs without shell expansion, streams bounded output, and returns the exit result.';
}

export class RunTestsTool extends CommandTool {
  public readonly name = 'run_tests';
  public readonly description =
    'Propose a structured project test command. It uses the same explicit approval, timeout, cancellation, and output limits as run_command.';
}

export function registerCommandTools(
  registry: { register(tool: AgentTool): void },
  commands: CommandService,
): void {
  registry.register(new RunCommandTool(commands));
  registry.register(new RunTestsTool(commands));
}
