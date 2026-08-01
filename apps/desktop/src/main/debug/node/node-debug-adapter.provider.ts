import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { NodeDebugAdapterProcess } from './node-debug-adapter-process';
import { NodeDebugAdapterSession } from './node-debug-adapter-session';

const supportedProjectTypes = new Set(['node', 'typescript', 'react', 'vue', 'nextjs']);

export interface NodeDebugAdapterProviderOptions {
  readonly executable: string;
  readonly serverPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}

export class NodeDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'pwa-node';
  public readonly displayName = 'Node.js / TypeScript';

  public constructor(private readonly options: NodeDebugAdapterProviderOptions) {}

  public async isAvailable(): Promise<boolean> {
    return (await stat(this.options.serverPath).catch(() => null))?.isFile() === true;
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!supportedProjectTypes.has(configuration.projectType)) {
      errors.push(`Node.js 调试适配器不支持项目类型 ${configuration.projectType}。`);
    }
    if (!(await this.isAvailable())) {
      errors.push('Node.js 调试适配器资源不可用，请重新安装 OpenCode Desk。');
    }
    if (configuration.executable.trim() === '') {
      errors.push('运行配置缺少可执行程序。');
    }
    const executableName = basename(configuration.executable).toLocaleLowerCase('en-US');
    if (!['node', 'node.exe'].includes(executableName)) {
      warnings.push('该配置将通过自定义运行时启动，调试结果取决于运行时是否创建 Node.js 进程。');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }
    const process = await NodeDebugAdapterProcess.start({
      executable: this.options.executable,
      serverPath: this.options.serverPath,
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
    });
    return NodeDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      command: input.command,
      environment: input.environment,
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPauseMode: input.exceptionPauseMode,
    });
  }
}
