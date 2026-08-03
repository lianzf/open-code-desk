import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { localizeMainProcessError } from './main-process-error-i18n';

const zhCN = {
  mainProcessUnavailable: '无法连接桌面端主进程，请重新启动应用。',
  chatOperationFailed: '操作失败，请检查模型配置和网络连接。',
  toolResultUnavailable: '工具结果无法显示。',
  selectProvider: '请先配置并选择一个模型服务。',
  requestIdMismatch: '主进程返回了不匹配的请求标识。',
  contextOperationFailed: '上下文操作失败，请重试。',
  commandOperationFailed: '命令操作失败。',
  changeOperationFailed: '变更审核操作失败。',
  fileOperationFailed: '文件操作失败，请重试。',
  unsavedCloseConfirm: '该文件有未保存修改，确定关闭吗？',
  fileChangedExternally:
    '{path} 已在磁盘上发生变化。请复制未保存内容并重新打开文件，系统不会覆盖外部修改。',
  fileUnavailable: '{path} 已被移动、删除或暂时无法读取。编辑器保留当前内容，不会自动写回磁盘。',
  gitReadFailed: '无法读取 Git 信息。',
  debugOperationFailed: '调试操作失败，请查看调试控制台。',
  providerOperationFailed: '操作失败，请检查配置后重试。',
  settingsOperationFailed: '应用设置操作失败，请重试。',
  workspaceOperationFailed: '工作区操作失败，请重试。',
  runOperationFailed: '运行操作失败，请检查配置后重试。',
  workspaceNotOpen: '工作区尚未打开。',
} as const;

export type RendererErrorKey = keyof typeof zhCN;

const enUS: Record<RendererErrorKey, string> = {
  mainProcessUnavailable: 'Unable to connect to the desktop main process. Restart the app.',
  chatOperationFailed:
    'The operation failed. Check the model configuration and network connection.',
  toolResultUnavailable: 'The tool result cannot be displayed.',
  selectProvider: 'Configure and select a model provider first.',
  requestIdMismatch: 'The main process returned a mismatched request identifier.',
  contextOperationFailed: 'The context operation failed. Try again.',
  commandOperationFailed: 'The command operation failed.',
  changeOperationFailed: 'The change review operation failed.',
  fileOperationFailed: 'The file operation failed. Try again.',
  unsavedCloseConfirm: 'This file has unsaved changes. Close it anyway?',
  fileChangedExternally:
    '{path} changed on disk. Copy any unsaved content and reopen the file; OpenCode Desk will not overwrite the external change.',
  fileUnavailable:
    '{path} was moved, deleted, or is temporarily unreadable. The editor retained the current content and will not write it back automatically.',
  gitReadFailed: 'Unable to read Git information.',
  debugOperationFailed: 'The debug operation failed. Check the debug console.',
  providerOperationFailed: 'The operation failed. Check the configuration and try again.',
  settingsOperationFailed: 'The app settings operation failed. Try again.',
  workspaceOperationFailed: 'The workspace operation failed. Try again.',
  runOperationFailed: 'The run operation failed. Check the configuration and try again.',
  workspaceNotOpen: 'No workspace is open.',
};

const messages: Record<AppSettings['locale'], Record<RendererErrorKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function currentRendererLocale(): AppSettings['locale'] {
  return typeof document !== 'undefined' && document.documentElement.lang === 'en-US'
    ? 'en-US'
    : 'zh-CN';
}

export function rendererError(
  key: RendererErrorKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const template = messages[currentRendererLocale()][key];
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function rendererErrorMessage(
  error: unknown,
  fallbackKey: RendererErrorKey,
  code?: string,
): string {
  const fallback = rendererError(fallbackKey);
  if (!(error instanceof Error)) return fallback;
  return localizeMainProcessError(currentRendererLocale(), error.message, code, fallback);
}

export function rendererErrorDetail(
  message: string,
  code: string | undefined,
  fallbackKey: RendererErrorKey,
): string {
  return localizeMainProcessError(
    currentRendererLocale(),
    message,
    code,
    rendererError(fallbackKey),
  );
}
