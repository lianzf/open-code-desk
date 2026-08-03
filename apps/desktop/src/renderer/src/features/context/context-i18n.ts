import type { AppSettings } from '@open-code-desk/ipc-contracts';

const zhCN = {
  typeFile: '文件',
  typeSelection: '选中代码',
  typeDirectory: '目录',
  typeGitDiff: 'Git Diff',
  typeTerminal: '终端',
  typeDiagnostic: '报错',
  typeImage: '图片',
  typeText: '文本',
  typeSummary: '摘要',
  supplement: '补充说明',
  contextItems: '上下文 {value} 项',
  approximateTokens: '约 {value} tokens',
  syncing: '同步中…',
  image: '图片',
  pasteText: '粘贴文本',
  removeContext: '移除上下文 {name}',
  addTextContext: '添加文本上下文',
  addTextDescription: '粘贴补充代码、报错或任务说明。',
  contextTitle: '上下文标题',
  pastePlaceholder: '粘贴补充代码、报错或说明',
  cancel: '取消',
  add: '添加',
} as const;

type ContextTranslationKey = keyof typeof zhCN;

const enUS: Record<ContextTranslationKey, string> = {
  typeFile: 'File',
  typeSelection: 'Selected code',
  typeDirectory: 'Directory',
  typeGitDiff: 'Git Diff',
  typeTerminal: 'Terminal',
  typeDiagnostic: 'Diagnostic',
  typeImage: 'Image',
  typeText: 'Text',
  typeSummary: 'Summary',
  supplement: 'Additional context',
  contextItems: '{value} context items',
  approximateTokens: 'About {value} tokens',
  syncing: 'Syncing…',
  image: 'Image',
  pasteText: 'Paste text',
  removeContext: 'Remove context {name}',
  addTextContext: 'Add text context',
  addTextDescription: 'Paste additional code, diagnostics, or task instructions.',
  contextTitle: 'Context title',
  pastePlaceholder: 'Paste additional code, diagnostics, or instructions',
  cancel: 'Cancel',
  add: 'Add',
};

const messages: Record<AppSettings['locale'], Record<ContextTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function translateContext(
  locale: AppSettings['locale'],
  key: ContextTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key],
  );
}
