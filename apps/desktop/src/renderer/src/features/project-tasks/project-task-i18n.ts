import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { useAppSettingsStore } from '@/features/settings/app-settings.store';

const zhCN = {
  pendingApproval: '等待批准',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  stopped: '已停止',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  lowRisk: '低风险',
  mediumRisk: '中风险',
  highRisk: '高风险',
  blocked: '已阻止',
  projectTasks: '项目任务',
  noTasks: '暂无任务',
  new: '新建',
  edit: '编辑',
  run: '执行',
  stop: '停止',
  executionHistory: '任务执行历史',
  noExecutions: '暂无执行记录',
  closeProjectTasks: '关闭项目任务',
  createTaskHelp: '新建任务后可配置依赖并执行。',
  taskDetails: '目录：{directory} · 超时：{seconds} 秒',
  workspaceRoot: '工作区根目录',
  dependencies: '依赖：{value}',
  none: '无',
  stepCount: '步骤 {count}',
  approvalHelp: '批准范围包含上方全部依赖步骤；任一任务变化都会使本次批准失效。',
  digest: '摘要 {value}',
  reject: '拒绝',
  approveRun: '批准执行',
  runAgain: '再次执行',
  emptyOutputHelp: '选择任务并点击执行后，审批计划与实时输出会显示在这里。',
  waitingOutput: '等待任务输出…',
  newProjectTask: '新增项目任务',
  editNamedTask: '编辑 {name}',
  dialogDescription: '依赖按拓扑顺序执行；每次执行完整计划都需要批准',
  closeProjectTask: '关闭项目任务',
  name: '名称',
  taskType: '任务类型',
  executable: '可执行文件',
  executablePlaceholder: '例如 pnpm、npm、python',
  arguments: '参数（每行一个）',
  workingDirectory: '工作目录（工作区相对路径）',
  timeoutSeconds: '超时（秒）',
  taskDependencies: '任务依赖',
  dependencyHelp: '共享依赖只执行一次，循环依赖会被拒绝',
  noDependencyCandidates: '暂无可选任务',
  deleteConfirm: '确定删除“{name}”吗？',
  delete: '删除',
  cancel: '取消',
  saving: '保存中…',
  save: '保存',
} as const;

export type ProjectTaskTranslationKey = keyof typeof zhCN;

const enUS: Record<ProjectTaskTranslationKey, string> = {
  pendingApproval: 'Waiting for approval',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  lowRisk: 'Low risk',
  mediumRisk: 'Medium risk',
  highRisk: 'High risk',
  blocked: 'Blocked',
  projectTasks: 'Project tasks',
  noTasks: 'No tasks',
  new: 'New',
  edit: 'Edit',
  run: 'Run',
  stop: 'Stop',
  executionHistory: 'Task execution history',
  noExecutions: 'No execution history',
  closeProjectTasks: 'Close project tasks',
  createTaskHelp: 'Create a task to configure dependencies and run it.',
  taskDetails: 'Directory: {directory} · Timeout: {seconds} seconds',
  workspaceRoot: 'Workspace root',
  dependencies: 'Dependencies: {value}',
  none: 'None',
  stepCount: '{count} steps',
  approvalHelp:
    'Approval covers every dependency step above; any task change invalidates this approval.',
  digest: 'Digest {value}',
  reject: 'Reject',
  approveRun: 'Approve run',
  runAgain: 'Run again',
  emptyOutputHelp: 'Select a task and choose Run to see the approval plan and live output here.',
  waitingOutput: 'Waiting for task output…',
  newProjectTask: 'New project task',
  editNamedTask: 'Edit {name}',
  dialogDescription: 'Dependencies run in topological order; each complete plan requires approval',
  closeProjectTask: 'Close project task',
  name: 'Name',
  taskType: 'Task type',
  executable: 'Executable',
  executablePlaceholder: 'For example pnpm, npm, or python',
  arguments: 'Arguments (one per line)',
  workingDirectory: 'Working directory (workspace-relative)',
  timeoutSeconds: 'Timeout (seconds)',
  taskDependencies: 'Task dependencies',
  dependencyHelp: 'Shared dependencies run once; dependency cycles are rejected',
  noDependencyCandidates: 'No available tasks',
  deleteConfirm: 'Delete “{name}”?',
  delete: 'Delete',
  cancel: 'Cancel',
  saving: 'Saving…',
  save: 'Save',
};

const messages: Record<AppSettings['locale'], Record<ProjectTaskTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function translateProjectTask(
  locale: AppSettings['locale'],
  key: ProjectTaskTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key],
  );
}

export function useProjectTaskTranslation(): {
  readonly locale: AppSettings['locale'];
  readonly t: (
    key: ProjectTaskTranslationKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
} {
  const locale = useAppSettingsStore((state) => state.settings.locale);
  return { locale, t: (key, values) => translateProjectTask(locale, key, values) };
}
