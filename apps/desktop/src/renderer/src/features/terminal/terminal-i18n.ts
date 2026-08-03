import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { useAppSettingsStore } from '@/features/settings/app-settings.store';

const zhCN = {
  startFailedGeneric: '无法启动集成终端。',
  processExitedMessage: '[进程已退出，退出码 {code}]',
  interactiveTerminal: '交互终端',
  userControlled: '用户控制',
  starting: '正在启动',
  startFailed: '启动失败',
  exited: '已退出{code}',
  terminalContextTitle: '终端输出 · {cwd}',
  workspace: '工作区',
  addOutputContext: '将终端输出加入上下文',
  addOutputContextTitle: '将当前终端输出加入 AI 上下文',
  stopTerminal: '终止终端进程',
  restartTerminal: '重新启动终端',
  closeTerminal: '关闭终端面板',
} as const;

export type TerminalTranslationKey = keyof typeof zhCN;

const enUS: Record<TerminalTranslationKey, string> = {
  startFailedGeneric: 'Unable to start the integrated terminal.',
  processExitedMessage: '[Process exited with code {code}]',
  interactiveTerminal: 'Interactive terminal',
  userControlled: 'User controlled',
  starting: 'Starting',
  startFailed: 'Start failed',
  exited: 'Exited{code}',
  terminalContextTitle: 'Terminal output · {cwd}',
  workspace: 'Workspace',
  addOutputContext: 'Add terminal output to context',
  addOutputContextTitle: 'Add current terminal output to AI context',
  stopTerminal: 'Stop terminal process',
  restartTerminal: 'Restart terminal',
  closeTerminal: 'Close terminal panel',
};

const messages: Record<AppSettings['locale'], Record<TerminalTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function translateTerminal(
  locale: AppSettings['locale'],
  key: TerminalTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key],
  );
}

export function useTerminalTranslation(): {
  readonly locale: AppSettings['locale'];
  readonly t: (
    key: TerminalTranslationKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
} {
  const locale = useAppSettingsStore((state) => state.settings.locale);
  return { locale, t: (key, values) => translateTerminal(locale, key, values) };
}
