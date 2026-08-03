import type { AppSettings } from '@open-code-desk/ipc-contracts';

import {
  additionalChineseRules,
  additionalExactChinese,
  additionalEnglishRules,
  additionalExactEnglish,
} from './main-process-error-additional-i18n';
import { domainChineseRules, domainExactChinese } from './main-process-error-domain-i18n';
import { workspaceEnglishRules, workspaceExactEnglish } from './main-process-error-workspace-i18n';

type Locale = AppSettings['locale'];
type MatchTranslator = (match: RegExpMatchArray) => string;

const electronErrorPrefix = /^Error invoking remote method '[^']+': Error: /;

const englishByCode: Readonly<Record<string, string>> = {
  DEBUG_CONFIGURATION_CHANGED:
    'The debug configuration changed after approval. Review and start debugging again.',
  DEBUG_INTERRUPTED:
    'The app closed before the debug session finished. Start the debug session again.',
  DEBUG_POST_TASK_FAILED: 'The post-debug task failed. Review its output and retry.',
  DEBUG_PRE_LAUNCH_TASK_FAILED: 'The pre-debug task failed. Review its output and retry.',
  DEBUG_RESTART_FAILED: 'The debug session could not be restarted. Review the console and retry.',
  DEBUG_START_FAILED: 'Debugging could not start. Review the debug console and retry.',
  PROJECT_TASK_APPROVAL_STALE:
    'The project task changed after approval. Review the task and approve it again.',
  PROJECT_TASK_CHANGED: 'The project task changed. Review it and start again.',
  PROJECT_TASK_COMMAND_BLOCKED:
    'The project task contains a blocked command. Review the command and security policy.',
  PROJECT_TASK_DEPENDENCY_CYCLE:
    'The project task dependency graph contains a cycle. Update the task dependencies.',
  PROJECT_TASK_DEPENDENCY_MISSING:
    'A project task dependency is missing. Restore it or update the task configuration.',
  PROJECT_TASK_EXECUTION_NOT_FOUND:
    'The project task execution no longer exists. Refresh the list.',
  PROJECT_TASK_INTERRUPTED:
    'The app closed before the project task finished. Start the task again.',
  PROJECT_TASK_NOT_FOUND: 'The project task no longer exists. Refresh the task list.',
  PROJECT_TASK_NOT_PENDING: 'The project task is no longer waiting for approval. Refresh the list.',
  PROJECT_TASK_START_FAILED: 'The project task could not start. Review its output and retry.',
  PROJECT_TASK_STEP_FAILED: 'A project task step failed. Review its output and retry.',
  PROJECT_TASK_TIMEOUT: 'The project task timed out. Review its timeout and command output.',
  RUN_ALREADY_ACTIVE: 'This service is already running. Stop it before starting another instance.',
  RUN_APPROVAL_STALE: 'The run request changed after approval. Review and approve it again.',
  RUN_COMMAND_BLOCKED: 'The run command is blocked by the security policy.',
  RUN_CONFIGURATION_CHANGED:
    'The run configuration changed after approval. Review and start it again.',
  RUN_CONFIGURATION_NOT_FOUND: 'The run configuration no longer exists. Refresh the list.',
  RUN_INTERRUPTED: 'The app closed before the run finished. Start the run again.',
  RUN_NOT_FOUND: 'The run record no longer exists. Refresh the run history.',
  RUN_NOT_PENDING: 'The run request is no longer waiting for approval. Refresh the list.',
  RUN_PORT_CONFLICT: 'The configured port is already in use. Change the port or review its owner.',
  RUN_PORT_MANAGED: 'The port is owned by a run managed by this app. Stop that run first.',
  RUN_PORT_OWNER_CHANGED: 'The process using the port changed. Inspect it and confirm again.',
  RUN_PORT_OWNER_INVALID: 'The port owner does not belong to the current workspace.',
  RUN_PORT_OWNER_UNKNOWN: 'The process using the port could not be identified safely.',
  RUN_PORT_SELF: 'OpenCode Desk cannot terminate its own process.',
  RUN_PORT_TERMINATE_FAILED: 'The process using the port could not be terminated safely.',
  RUN_POST_TASK_FAILED: 'The post-run task failed. Review its output and retry.',
  RUN_PRE_LAUNCH_TASK_FAILED: 'The pre-run task failed. Review its output and retry.',
  RUN_PROCESS_FAILED: 'The run process failed. Review its output and exit code.',
  RUN_PROCESS_MISSING: 'The run process no longer exists. Its state was cleaned up.',
  RUN_START_FAILED: 'The project could not start. Review its output and retry.',
  RUN_TASK_EXECUTOR_MISSING: 'The project task runner is unavailable. Restart OpenCode Desk.',
  RUN_TASKS_NOT_SUPPORTED: 'Project tasks are unavailable for this run service.',
};

const exactEnglish = new Map<string, string>([
  ['调试适配器连接已关闭。', 'The debug adapter connection closed.'],
  ['连接调试适配器超时。', 'Timed out while connecting to the debug adapter.'],
  ['调试客户端已关闭。', 'The debug client closed.'],
  ['DAP 消息头超过安全限制。', 'The DAP message headers exceeded the safety limit.'],
  ['调试适配器返回了无效 DAP 消息。', 'The debug adapter returned an invalid DAP message.'],
  ['DAP 消息缺少 Content-Length。', 'The DAP message is missing Content-Length.'],
  ['DAP 消息长度超过安全限制。', 'The DAP message exceeded the safety limit.'],
  ['找不到调试会话。', 'The debug session no longer exists. Refresh the debug history.'],
  ['调试会话当前未运行。', 'The debug session is not currently running.'],
  ['调试请求已不再等待批准。', 'The debug request is no longer waiting for approval.'],
  ['调试配置已变化，请重新审核。', 'The debug configuration changed. Review it again.'],
  ['调试配置已变化，请重新发起调试。', 'The debug configuration changed. Start debugging again.'],
  [
    '只有正在运行或暂停的调试会话可以重新启动。',
    'Only a running or paused debug session can be restarted.',
  ],
  ['项目任务执行器不可用。', 'The project task runner is unavailable. Restart OpenCode Desk.'],
  ['运行到光标位置需要调试会话处于暂停状态。', 'Pause debugging before running to the cursor.'],
  ['当前光标位置没有可执行的调试目标。', 'There is no executable debug target at the cursor.'],
  [
    '当前光标位置没有可执行的 Python 调试目标。',
    'There is no executable Python debug target at the cursor.',
  ],
  [
    '找不到随应用分发的 Node.js 调试适配器。',
    'The bundled Node.js debug adapter is missing. Reinstall OpenCode Desk.',
  ],
  [
    '找不到随应用分发的 Python 调试适配器，请重新安装 OpenCode Desk。',
    'The bundled Python debug adapter is missing. Reinstall OpenCode Desk.',
  ],
  ['调试适配器没有有效进程 ID。', 'The debug adapter did not provide a valid process ID.'],
  [
    'Python 调试适配器没有有效进程 ID。',
    'The Python debug adapter did not provide a valid process ID.',
  ],
  ['等待 debugpy 端点超时。', 'Timed out while waiting for the debugpy endpoint.'],
  ['Node.js 调试适配器启动超时。', 'The Node.js debug adapter timed out during startup.'],
  ['调试器请求了无效的子会话类型。', 'The debugger requested an invalid child-session type.'],
  ['断点初始化失败。', 'Breakpoint initialization failed.'],
  ['行断点缺少文件位置。', 'The line breakpoint is missing a file location.'],
  ['特殊断点缺少调试器标识。', 'The special breakpoint is missing a debugger identifier.'],
  ['找不到断点。', 'The breakpoint no longer exists. Refresh the breakpoint list.'],
  ['断点不能移动到其他工作区。', 'A breakpoint cannot be moved to another workspace.'],
  ['监视表达式不能移动到其他工作区。', 'A watch expression cannot be moved to another workspace.'],
  ['找不到当前工作区的调试配置。', 'No debug configuration exists in the current workspace.'],
  ['调试任务快照不存在。', 'The debug task snapshot no longer exists.'],
  ['找不到运行记录。', 'The run record no longer exists. Refresh the run history.'],
  ['该运行请求已不再等待批准。', 'The run request is no longer waiting for approval.'],
  [
    '运行命令或配置已变化，请重新审核。',
    'The run command or configuration changed. Review it again.',
  ],
  [
    '运行配置在批准前已变化，请重新发起运行。',
    'The run configuration changed. Start the run again.',
  ],
  [
    '该服务已有正在进行的运行，请先停止后再启动。',
    'This service is already running. Stop it before starting again.',
  ],
  ['运行进程已不存在，状态已清理。', 'The run process no longer exists. Its state was cleaned up.'],
  ['运行服务未配置项目任务执行器。', 'The run service has no project task runner configured.'],
  ['项目任务执行器不可用。', 'The project task runner is unavailable. Restart OpenCode Desk.'],
  ['运行进程返回了无法识别的错误。', 'The run process returned an unrecognized error.'],
  [
    '运行工作目录不在当前工作区内，或该路径不是目录。',
    'The run working directory is outside the workspace or is not a directory.',
  ],
  [
    '环境变量文件不在当前工作区内，或该路径不是文件。',
    'The environment file is outside the workspace or is not a file.',
  ],
  ['环境变量文件超过 1 MiB 安全限制。', 'The environment file exceeds the 1 MiB safety limit.'],
  [
    '环境变量文件在批准前已发生变化，请重新审核运行请求。',
    'The environment file changed after approval. Review the run request again.',
  ],
  [
    '端口占用进程已变化，请重新检查并确认。',
    'The process using the port changed. Inspect and confirm it again.',
  ],
  [
    '该端口由本软件管理的运行占用，请使用停止运行操作。',
    'The port is owned by a run managed by OpenCode Desk. Stop that run first.',
  ],
  [
    '无法安全识别端口占用进程，未执行终止操作。',
    'The process using the port could not be identified safely, so it was not terminated.',
  ],
  ['不能终止当前应用进程。', 'OpenCode Desk cannot terminate its own process.'],
]);

const englishRules: ReadonlyArray<readonly [RegExp, MatchTranslator]> = [
  [/^调试请求 (.+) 超时。$/, (match) => `Debug request ${match[1]} timed out.`],
  [/^等待调试事件 (.+) 超时。$/, (match) => `Timed out while waiting for debug event ${match[1]}.`],
  [/^调试请求 (.+) 执行失败。$/, (match) => `Debug request ${match[1]} failed.`],
  [
    /^OpenCode Desk 暂不支持调试器反向请求 (.+)。$/,
    (match) => `Debugger reverse request ${match[1]} is not supported.`,
  ],
  [
    /^Python 调试器发起了不受支持的反向请求 (.+)。$/,
    (match) => `Debugger reverse request ${match[1]} is not supported.`,
  ],
  [
    /^暂不支持调试器反向请求 (.+)。$/,
    (match) => `Debugger reverse request ${match[1]} is not supported.`,
  ],
  [
    /^当前调试适配器不支持函数断点。$/,
    () => 'The current debug adapter does not support function breakpoints.',
  ],
  [
    /^当前调试适配器不支持数据断点。$/,
    () => 'The current debug adapter does not support data breakpoints.',
  ],
  [/^调试适配器 (.+) 已注册。$/, (match) => `Debug adapter ${match[1]} is already registered.`],
  [/^未注册调试适配器 (.+)。$/, (match) => `Debug adapter ${match[1]} is not registered.`],
  [
    /^当前工作区已有调试会话“(.+)”正在处理，请先停止或拒绝它。$/,
    (match) =>
      `Debug session “${match[1]}” is already active in this workspace. Stop or reject it first.`,
  ],
  [
    /^当前阶段尚未提供 (.+) 项目的调试适配器。$/,
    (match) => `No debug adapter is currently available for ${match[1]} projects.`,
  ],
  [
    /^调试启动失败：(.+)$/,
    (match) => `Debugging failed to start: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^重新调试失败：(.+)$/,
    (match) => `Debugging failed to restart: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^调试前任务执行失败：(.+)$/,
    (match) => `The pre-debug task failed: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^调试后任务执行失败：(.+)$/,
    (match) => `The post-debug task failed: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^Python 调试器启动失败：(.+) 请确认运行配置选择的是 Python 3\.8 或更高版本。$/,
    (match) =>
      `The Python debugger failed to start: ${match[1]} Select Python 3.8 or newer in the run configuration.`,
  ],
  [
    /^适配器提前退出（退出码 (.+)）。\s*(.*)$/,
    (match) =>
      `The debug adapter exited early with code ${match[1]}.${match[2] === '' ? '' : ` ${match[2]}`}`,
  ],
  [
    /^Node\.js 调试适配器提前退出，退出码 (.+)。\s*(.*)$/,
    (match) =>
      `The Node.js debug adapter exited early with code ${match[1]}.${match[2] === '' ? '' : ` ${match[2]}`}`,
  ],
  [
    /^Node\.js 调试适配器不支持项目类型 (.+)。$/,
    (match) => `The Node.js debug adapter does not support project type ${match[1]}.`,
  ],
  [
    /^Python 调试适配器不支持项目类型 (.+)。$/,
    (match) => `The Python debug adapter does not support project type ${match[1]}.`,
  ],
  [
    /^断点初始化失败：(.+)$/,
    (match) => `Breakpoint initialization failed: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^项目启动失败：(.+)$/,
    (match) => `The project failed to start: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^启动前任务执行失败：(.+)$/,
    (match) => `The pre-run task failed: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^启动后任务执行失败：(.+)$/,
    (match) => `The post-run task failed: ${translateNested(capture(match, 1))}`,
  ],
  [
    /^端口 (\d+) 已被 (.+) 占用，请更换端口或确认后终止占用进程。$/,
    (match) =>
      `Port ${match[1]} is in use by ${match[2]}. Change the port or confirm before terminating the process.`,
  ],
  [
    /^终止端口占用进程失败：(.+)$/,
    (match) => `Failed to terminate the process using the port: ${match[1]}`,
  ],
  [
    /^敏感环境变量 (.+) 缺少(?:安全)?凭据引用。$/,
    (match) =>
      `Sensitive environment variable ${match[1]} is missing a secure credential reference.`,
  ],
  [
    /^敏感环境变量 (.+) 的(?:安全)?凭据不可用。$/,
    (match) =>
      `The secure credential for sensitive environment variable ${match[1]} is unavailable.`,
  ],
  [/^运行环境变量 (.+) 重复。$/, (match) => `Run environment variable ${match[1]} is duplicated.`],
  [
    /^环境变量文件第 (\d+) 行格式无效。$/,
    (match) => `Line ${match[1]} of the environment file has an invalid format.`,
  ],
  [
    /^环境变量文件第 (\d+) 行的变量名无效。$/,
    (match) => `Line ${match[1]} of the environment file has an invalid variable name.`,
  ],
  [
    /^环境变量文件第 (\d+) 行包含无效字符。$/,
    (match) => `Line ${match[1]} of the environment file contains invalid characters.`,
  ],
];

export function stripMainProcessErrorEnvelope(message: string): string {
  return message.replace(electronErrorPrefix, '');
}

export function localizeMainProcessError(
  locale: Locale,
  message: string,
  code: string | undefined,
  fallback: string,
): string {
  const raw = stripMainProcessErrorEnvelope(message).trim();
  if (raw === '') return fallback;
  if (locale === 'zh-CN') return translateChinese(raw) ?? raw;
  return (
    translateEnglish(raw) ?? (code === undefined ? undefined : englishByCode[code]) ?? fallback
  );
}

function translateChinese(message: string): string | undefined {
  const exact = additionalExactChinese.get(message) ?? domainExactChinese.get(message);
  if (exact !== undefined) return exact;
  for (const [pattern, translate] of [...additionalChineseRules, ...domainChineseRules]) {
    const match = message.match(pattern);
    if (match !== null) return translate(match);
  }
  return undefined;
}

function translateEnglish(message: string): string | undefined {
  const exact =
    exactEnglish.get(message) ??
    additionalExactEnglish.get(message) ??
    workspaceExactEnglish.get(message);
  if (exact !== undefined) return exact;
  for (const [pattern, translate] of [
    ...englishRules,
    ...additionalEnglishRules,
    ...workspaceEnglishRules,
  ]) {
    const match = message.match(pattern);
    if (match !== null) return translate(match);
  }
  if (!/\p{Script=Han}/u.test(message)) return message;
  return undefined;
}

function translateNested(message: string): string {
  return translateEnglish(message) ?? message;
}

function capture(match: RegExpMatchArray, index: number): string {
  return match[index] ?? '';
}
