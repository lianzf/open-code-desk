import type { AppSettings } from '@open-code-desk/ipc-contracts';

const chineseReasons = new Map<string, string>([
  [
    'Every access to a user-granted external directory requires explicit approval.',
    '每次访问用户授权的外部目录都需要明确批准。',
  ],
  [
    'Workspace read tools require approval under the current permission settings.',
    '当前权限设置要求批准工作区读取工具。',
  ],
  ['Read-only workspace tool.', '只读工作区工具。'],
  [
    'The tool stages an immutable proposal and enforces approval at its side-effect boundary.',
    '该工具仅暂存不可变提案，并在产生副作用前强制要求批准。',
  ],
  ['Dangerous tools are denied by default.', '默认拒绝危险工具。'],
  ['A side effect requires explicit approval.', '产生副作用需要明确批准。'],
]);

export function localizeApprovalReason(locale: AppSettings['locale'], reason: string): string {
  return locale === 'zh-CN' ? (chineseReasons.get(reason) ?? reason) : reason;
}
