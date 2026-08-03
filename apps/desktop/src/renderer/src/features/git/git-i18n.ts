import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { useAppSettingsStore } from '@/features/settings/app-settings.store';

const zhCN = {
  conflicted: '冲突',
  untracked: '未跟踪',
  stagedModified: '暂存 + 修改',
  staged: '已暂存',
  modified: '已修改',
  cleanWorkspace: '工作区干净',
  changeCount: '{count} 个变更',
  allChanges: '全部变更',
  stagedArea: '暂存区',
  workspace: '工作区',
  diffContextTitle: '{scope} Diff · {path}',
  addDiffContext: '将当前 Git Diff 加入上下文',
  addDiffContextTitle: '将当前 Git Diff 加入 AI 上下文',
  refreshStatus: '刷新 Git 状态',
  closePanel: '关闭 Git 面板',
  readingGit: '正在读取 Git…',
  notRepository: '当前工作区不是 Git 仓库',
  workspaceDiff: '工作区 Diff',
  stagedDiff: '暂存区 Diff',
  diffTruncated: 'Diff 已截断',
  emptyDiff: '此范围没有可显示的 Diff。未跟踪文件在纳入 Git 前不会生成标准 Diff。',
} as const;

export type GitTranslationKey = keyof typeof zhCN;

const enUS: Record<GitTranslationKey, string> = {
  conflicted: 'Conflicted',
  untracked: 'Untracked',
  stagedModified: 'Staged + modified',
  staged: 'Staged',
  modified: 'Modified',
  cleanWorkspace: 'Working tree clean',
  changeCount: '{count} changes',
  allChanges: 'All changes',
  stagedArea: 'Index',
  workspace: 'Working tree',
  diffContextTitle: '{scope} Diff · {path}',
  addDiffContext: 'Add current Git Diff to context',
  addDiffContextTitle: 'Add current Git Diff to AI context',
  refreshStatus: 'Refresh Git status',
  closePanel: 'Close Git panel',
  readingGit: 'Reading Git…',
  notRepository: 'The current workspace is not a Git repository',
  workspaceDiff: 'Working tree Diff',
  stagedDiff: 'Index Diff',
  diffTruncated: 'Diff truncated',
  emptyDiff:
    'No Diff is available for this scope. Untracked files have no standard Diff until they are added to Git.',
};

const messages: Record<AppSettings['locale'], Record<GitTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function useGitTranslation(): {
  readonly t: (
    key: GitTranslationKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
} {
  const locale = useAppSettingsStore((state) => state.settings.locale);
  return {
    t: (key, values = {}) =>
      Object.entries(values).reduce(
        (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
        messages[locale][key],
      ),
  };
}
