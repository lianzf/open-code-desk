import { describe, expect, it } from 'vitest';

import { localizeMainProcessError } from './main-process-error-i18n';

const translate = (message: string): string =>
  localizeMainProcessError('zh-CN', message, undefined, '操作失败。');

describe('main-process domain error localization', () => {
  it.each([
    ['File change set was not found.', '找不到文件变更集。'],
    [
      'The requested file is blocked by the sensitive-path policy.',
      '请求的文件被敏感路径策略阻止。',
    ],
    ['Conversation does not belong to the active workspace.', '该会话不属于当前工作区。'],
    ['The tool approval digest is stale.', '工具批准摘要已过期。'],
    ['The requested workspace is not the active workspace.', '请求的工作区不是当前工作区。'],
    ['netcoredbg was not found on PATH.', '在 PATH 中找不到 netcoredbg。'],
    ['dlv was not found on PATH.', '在 PATH 中找不到 dlv。'],
    ['lldb-dap was not found on PATH.', '在 PATH 中找不到 lldb-dap。'],
    ['Java LSP frame has no Content-Length.', 'Java LSP 消息帧缺少 Content-Length。'],
    [
      'Run history limit must be an integer between 1 and 1000.',
      '运行历史记录上限必须是 1 到 1000 之间的整数。',
    ],
  ])('translates an application-owned diagnostic: %s', (message, expected) => {
    expect(translate(message)).toBe(expected);
  });

  it.each([
    [
      'src/main.ts changed after apply; rollback was blocked.',
      'src/main.ts 在应用后发生变化，回滚已被阻止。',
    ],
    ['The review digest for src/main.ts is stale.', 'src/main.ts 的审核摘要已过期。'],
    ['LLDB did not expose DAP stdio streams.', 'LLDB 未提供 DAP 标准输入输出流。'],
    ['LLDB reverse request runInTerminal is not supported.', 'LLDB 不支持反向请求 runInTerminal。'],
    ['Run execution run-42 could not start: spawn ENOENT', '运行 run-42 无法启动：spawn ENOENT'],
    [
      'Sensitive run environment variable API_KEY cannot be persisted.',
      '敏感运行环境变量 API_KEY 不能写入持久化记录。',
    ],
    ['Java debugging is not supported on aix.', 'Java 调试不支持 aix 平台。'],
    ['The bundled JDT LS win32 configuration is missing.', '随应用分发的 JDT LS win32 配置缺失。'],
    ['Tool "read_file" is not registered.', '工具“read_file”未注册。'],
    [
      'The Agent reached the 64-tool-call safety limit. Completed progress was saved. Retry to continue from the conversation history.',
      '智能体已达到 64 次工具调用安全上限。已保存完成进度；点击“重试”可从当前会话继续。',
    ],
    [
      'The Agent reached the 24-model-round safety limit. Completed progress was saved. Retry to continue from the conversation history.',
      '智能体已达到 24 轮模型调用安全上限。已保存完成进度；点击“重试”可从当前会话继续。',
    ],
    [
      'Tool execution was skipped because the Agent reached its 64-tool-call safety limit. Retry the task to continue.',
      '智能体已达到 64 次工具调用安全上限，因此跳过了该工具；重试任务即可继续。',
    ],
  ])('translates an application-owned dynamic diagnostic: %s', (message, expected) => {
    expect(translate(message)).toBe(expected);
  });

  it('keeps an Electron envelope out of translated diagnostics', () => {
    expect(
      translate(
        "Error invoking remote method 'changes:apply': Error: The rollback digest is stale.",
      ),
    ).toBe('回滚摘要已过期。');
  });

  it('preserves unknown third-party diagnostics verbatim', () => {
    expect(translate('custom-debugger: protocol handshake failed')).toBe(
      'custom-debugger: protocol handshake failed',
    );
  });
});
