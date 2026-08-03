import type { AppSettings } from '@open-code-desk/ipc-contracts';

const zhCN = {
  currentPause: '当前暂停位置',
  readingFile: '正在读取文件…',
  unsaved: '未保存',
  closeFile: '关闭 {name}',
  addCurrentFileContext: '将当前文件加入 AI 上下文',
  currentFile: '当前文件',
  addSelectionContext: '将选中代码加入 AI 上下文',
  selectedCode: '选中代码',
  saveFile: '保存',
  openFileHint: '从左侧文件树打开代码文件',
  lazyFileHint: '文件内容仅在需要时读取，不会一次加载整个项目。',
  toggleBreakpoint: '切换断点',
  editBreakpoint: '编辑条件/日志断点…',
  deleteFileBreakpoints: '删除当前文件全部断点',
  runToCursor: '运行到光标',
  projectFiles: '项目文件',
  protectedPath: '{path}（受保护）',
  addDirectoryStructureContext: '将目录结构 {path} 加入 AI 上下文',
  addDirectoryContext: '添加目录上下文 {path}',
  movePathPrompt: '输入新的工作区相对路径（可用于重命名或移动）',
  unsavedMoveWarning: '此路径下存在未保存的编辑器内容。继续会关闭这些标签页。',
  movePath: '重命名或移动 {path}',
  unsavedDeleteWarning: '“{path}” 下存在未保存内容。删除将关闭对应标签页，确定继续吗？',
  deleteWarning: '确定删除“{path}”吗？非空目录不会被删除。',
  deletePath: '删除 {path}',
} as const;

type WorkspaceTranslationKey = keyof typeof zhCN;

const enUS: Record<WorkspaceTranslationKey, string> = {
  currentPause: 'Current pause location',
  readingFile: 'Reading file…',
  unsaved: 'Unsaved',
  closeFile: 'Close {name}',
  addCurrentFileContext: 'Add the current file to AI context',
  currentFile: 'Current file',
  addSelectionContext: 'Add selected code to AI context',
  selectedCode: 'Selected code',
  saveFile: 'Save',
  openFileHint: 'Open a code file from the file tree',
  lazyFileHint: 'File contents are loaded on demand; the whole project is never loaded at once.',
  toggleBreakpoint: 'Toggle breakpoint',
  editBreakpoint: 'Edit condition/logpoint…',
  deleteFileBreakpoints: 'Delete all breakpoints in this file',
  runToCursor: 'Run to cursor',
  projectFiles: 'Project files',
  protectedPath: '{path} (protected)',
  addDirectoryStructureContext: 'Add directory structure {path} to AI context',
  addDirectoryContext: 'Add directory context {path}',
  movePathPrompt: 'Enter a new workspace-relative path to rename or move this item',
  unsavedMoveWarning: 'This path contains unsaved editor content. Continuing closes those tabs.',
  movePath: 'Rename or move {path}',
  unsavedDeleteWarning:
    '“{path}” contains unsaved content. Deleting it closes those tabs. Continue?',
  deleteWarning: 'Delete “{path}”? Non-empty directories cannot be deleted.',
  deletePath: 'Delete {path}',
};

const messages: Record<AppSettings['locale'], Record<WorkspaceTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function translateWorkspace(
  locale: AppSettings['locale'],
  key: WorkspaceTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key],
  );
}
