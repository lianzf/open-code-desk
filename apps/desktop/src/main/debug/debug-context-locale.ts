import { createHash } from 'node:crypto';

import type { DebugSession } from '@open-code-desk/domain';
import type { PreviewDebugContextRequest } from '@open-code-desk/ipc-contracts';

import { redactSensitiveText } from '../security/sensitive-text';

export const debugContextText = {
  'zh-CN': {
    modelPrompt:
      '请分析我刚刚明确附加的调试上下文，定位根因，并按需读取相关工作区文件。请先说明判断依据；如需修复，只能通过文件变更工具生成待审核 FileChange 和 Diff，不要直接写入文件，不要自动重新启动调试，也不要执行未获批准的命令。',
    snapshot: '调试快照',
    auditSummary: '用户审核并附加了已脱敏的调试上下文。',
    location: '暂停位置',
    reason: '原因',
    description: '说明',
    thread: '线程',
    position: '位置',
    unknown: '未知',
    exception: '异常',
    message: '消息',
    stack: '调用栈',
    console: '调试控制台与程序输出',
    configuration: '运行配置',
    source: '暂停位置源码',
    variables: '局部变量与作用域',
    watches: '监视表达式',
    evaluationFailed: '求值失败',
    unstaged: '未暂存',
    staged: '已暂存',
    recentChanges: '最近文件变更',
    dependencies: '项目依赖',
    unknownError: '未知错误',
  },
  'en-US': {
    modelPrompt:
      'Analyze the debug context I explicitly attached, identify the root cause, and read relevant workspace files only as needed. Explain the evidence first. If a fix is needed, use file-change tools to create a reviewable FileChange and Diff; do not write files directly, restart debugging automatically, or execute unapproved commands.',
    snapshot: 'Debug snapshot',
    auditSummary: 'The user reviewed and attached redacted debug context.',
    location: 'Pause location',
    reason: 'Reason',
    description: 'Description',
    thread: 'Thread',
    position: 'Location',
    unknown: 'unknown',
    exception: 'Exception',
    message: 'Message',
    stack: 'Stack trace',
    console: 'Debug console and program output',
    configuration: 'Run configuration',
    source: 'Paused source',
    variables: 'Local variables and scopes',
    watches: 'Watch expressions',
    evaluationFailed: 'evaluation failed',
    unstaged: 'Unstaged',
    staged: 'Staged',
    recentChanges: 'Recent file changes',
    dependencies: 'Project dependencies',
    unknownError: 'Unknown error',
  },
} as const;

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function safeDebugContextError(
  error: unknown,
  locale: PreviewDebugContextRequest['locale'],
): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : debugContextText[locale].unknownError;
}

export function safePauseFingerprint(session: Pick<DebugSession, 'pause'>): string {
  return sha256(redactSensitiveText(JSON.stringify(session.pause)));
}
