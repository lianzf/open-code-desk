import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { DebugValidationResult, RunCommandSnapshot } from '@open-code-desk/domain';

import type {
  DebugAdapterLaunchInput,
  DebugAdapterSession,
  RuntimeDebugAdapterProvider,
} from '../debug-adapter';
import { PythonDebugAdapterProcess } from './python-debug-adapter-process';
import { PythonDebugAdapterSession } from './python-debug-adapter-session';
import { parsePythonLaunchTarget } from './python-debug-launch';

const pythonExecutablePattern = /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/iu;

export interface PythonDebugAdapterProviderOptions {
  readonly adapterPath: string;
}

export class PythonDebugAdapterProvider implements RuntimeDebugAdapterProvider {
  public readonly type = 'debugpy';
  public readonly displayName = 'Python (debugpy)';

  public constructor(private readonly options: PythonDebugAdapterProviderOptions) {}

  public async isAvailable(): Promise<boolean> {
    return (
      (await stat(join(this.options.adapterPath, '__main__.py')).catch(() => null))?.isFile() ===
      true
    );
  }

  public async validateConfiguration(
    configuration: RunCommandSnapshot,
  ): Promise<DebugValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (configuration.projectType !== 'python') {
      errors.push(`Python 调试适配器不支持项目类型 ${configuration.projectType}。`);
    }
    if (!(await this.isAvailable())) {
      errors.push('Python 调试适配器资源不可用，请重新安装 OpenCode Desk。');
    }
    const executableName = basename(configuration.executable).toLocaleLowerCase('en-US');
    if (!pythonExecutablePattern.test(executableName)) {
      errors.push('Python 调试配置必须选择 python、python3 或虚拟环境中的 Python 可执行文件。');
    }
    try {
      parsePythonLaunchTarget(configuration);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    if (!configuration.executable.includes('/') && !configuration.executable.includes('\\')) {
      warnings.push(
        '当前解释器依赖系统 PATH；为避免 IDE 重启后选错环境，建议选择自动发现的绝对路径。',
      );
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public async createSession(input: DebugAdapterLaunchInput): Promise<DebugAdapterSession> {
    const validation = await this.validateConfiguration(input.command);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const process = await PythonDebugAdapterProcess.start({
      executable: input.command.executable,
      adapterPath: this.options.adapterPath,
      workspaceRoot: input.workspaceRoot,
    });
    return PythonDebugAdapterSession.create({
      process,
      workspaceRoot: input.workspaceRoot,
      command: input.command,
      environment: input.environment,
      sensitiveValues: input.sensitiveValues,
      breakpoints: input.breakpoints,
      exceptionPolicy: input.exceptionPolicy,
    });
  }
}
