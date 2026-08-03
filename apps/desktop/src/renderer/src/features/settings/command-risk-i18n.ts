import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { currentRendererLocale } from './error-i18n';

type Locale = AppSettings['locale'];

const chineseReasons = new Map<string, string>([
  ['Encoded PowerShell commands are not allowed.', '不允许使用编码的 PowerShell 命令。'],
  ['The executable can delete files.', '该可执行程序可以删除文件。'],
  [
    'Recursive deletion of the workspace root or a filesystem root is blocked.',
    '已阻止递归删除工作区根目录或文件系统根目录。',
  ],
  [
    'A command interpreter can execute compound or redirected commands.',
    '命令解释器可以执行复合命令或重定向命令。',
  ],
  [
    'Downloading and immediately executing remote content is blocked.',
    '已阻止下载后立即执行远程内容。',
  ],
  ['This executable may access the network.', '该可执行程序可能访问网络。'],
  [
    'Package manager commands may execute project lifecycle scripts.',
    '包管理器命令可能执行项目生命周期脚本。',
  ],
  [
    'No known high-risk pattern was detected; explicit approval is still required.',
    '未检测到已知高风险模式；仍需明确批准。',
  ],
  [
    'Network commands are not globally allowed for this workspace.',
    '当前工作区未全局允许网络命令。',
  ],
  [
    'Attach debugging does not start or automatically terminate the target process.',
    '附加调试不会启动或自动终止目标进程。',
  ],
  [
    'Remote debug ports can grant control of the program; connect only to a trusted target and network.',
    '远程调试端口可能授予程序控制能力；请仅连接可信目标和网络。',
  ],
]);

export function rendererRiskReason(reason: string): string {
  return localizeRiskReason(currentRendererLocale(), reason);
}

export function localizeRiskReason(locale: Locale, reason: string): string {
  if (locale === 'en-US') {
    const hook = /^(启动前任务|启动后任务)：(.+)$/u.exec(reason);
    if (hook === null) return reason;
    return `${hook[1] === '启动前任务' ? 'Pre-launch task' : 'Post-run task'}: ${hook[2] ?? ''}`;
  }

  const hook = /^(启动前任务|启动后任务)：(.+)$/u.exec(reason);
  if (hook !== null) {
    return `${hook[1]}：${localizeChineseTaskReason(hook[2] ?? '')}`;
  }
  return localizeChineseTaskReason(reason);
}

function localizeChineseTaskReason(reason: string): string {
  const direct =
    chineseReasons.get(reason) ?? privilegedExecutableReason(reason) ?? debugAttachReason(reason);
  if (direct !== undefined) return direct;
  const separator = reason.indexOf(': ');
  if (separator < 0) return reason;
  const label = reason.slice(0, separator);
  const nested = reason.slice(separator + 2);
  const translated =
    chineseReasons.get(nested) ?? privilegedExecutableReason(nested) ?? debugAttachReason(nested);
  return translated === undefined ? reason : `${label}：${translated}`;
}

function debugAttachReason(reason: string): string | undefined {
  const patterns: ReadonlyArray<readonly [RegExp, (endpoint: string) => string]> = [
    [
      /^Electron renderer debugging opens a loopback Chromium DevTools endpoint at (.+) while the approved session is running\.$/u,
      (endpoint) =>
        `Electron 渲染进程调试会在获批会话运行期间开放本机 Chromium DevTools 端点 ${endpoint}。`,
    ],
    [
      /^The debugger will connect to the container target through local port forwarding at (.+)\.$/u,
      (endpoint) => `调试器将通过本机端口转发连接容器目标 ${endpoint}。`,
    ],
    [
      /^The debugger will connect to an existing local Node\.js target at (.+)\.$/u,
      (endpoint) => `调试器将连接已有本机 Node.js 目标 ${endpoint}。`,
    ],
    [
      /^The debugger will connect to a remote Node\.js target over the network at (.+)\.$/u,
      (endpoint) => `调试器将通过网络连接远程 Node.js 目标 ${endpoint}。`,
    ],
  ];
  for (const [pattern, translate] of patterns) {
    const match = pattern.exec(reason);
    if (match?.[1] !== undefined) return translate(match[1]);
  }
  return undefined;
}

function privilegedExecutableReason(reason: string): string | undefined {
  const match = /^(.+) is a privileged or system-control executable\.$/u.exec(reason);
  return match === null ? undefined : `${match[1] ?? ''} 是特权或系统控制可执行程序。`;
}
