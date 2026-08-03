type MatchTranslator = (match: RegExpMatchArray) => string;

export const domainExactChinese = new Map<string, string>([
  ['A bulk review entry does not belong to this change set.', '批量审核条目不属于当前变更集。'],
  ['A file path is required.', '必须提供文件路径。'],
  [
    'A proposal for this path already exists in the current change set. Submit one final mutation per path.',
    '当前变更集中已存在该路径的提案；每个路径只能提交一个最终变更。',
  ],
  [
    'Binary files cannot be changed by the text review workflow.',
    '文本审核流程不能修改二进制文件。',
  ],
  [
    'Bulk review requires a non-empty, unique list of visible changes.',
    '批量审核需要一组非空且不重复的可见变更。',
  ],
  ['Change artifact exceeds the 2 MB review limit.', '变更产物超过 2 MB 审核限制。'],
  ['File change set was not found.', '找不到文件变更集。'],
  ['File change was not found.', '找不到文件变更。'],
  [
    'Files larger than 2 MB cannot be changed in the review workflow.',
    '审核流程不能修改大于 2 MB 的文件。',
  ],
  ['Invalid change artifact reference.', '变更产物引用无效。'],
  ['No approved file changes are available to apply.', '没有可应用的已批准文件变更。'],
  ['Only an applied change set can be rolled back.', '只有已应用的变更集才能回滚。'],
  ['Only create and update proposals have editable content.', '只有创建和更新提案的内容可以编辑。'],
  ['Only regular, non-symbolic-link files can be changed.', '只能修改常规文件，不能修改符号链接。'],
  ['Prepared create content is missing.', '准备好的创建内容缺失。'],
  ['Prepared rename destination is missing.', '准备好的重命名目标缺失。'],
  ['Prepared update content is missing.', '准备好的更新内容缺失。'],
  ['Proposed file content exceeds the 2 MB review limit.', '提议的文件内容超过 2 MB 审核限制。'],
  ['Rename compensation destination is missing.', '重命名补偿目标缺失。'],
  [
    'The approval digest is stale. Review the visible changes again.',
    '批准摘要已过期，请重新审核可见变更。',
  ],
  ['The change set is not ready to apply.', '变更集尚未准备好应用。'],
  ['The patch does not change the file.', '补丁没有改变文件。'],
  ['The proposed content is identical to the workspace baseline.', '提议的内容与工作区基线相同。'],
  [
    'The proposed patch does not apply cleanly to the workspace baseline.',
    '提议的补丁无法干净地应用到工作区基线。',
  ],
  ['The proposed target parent is outside the workspace.', '提议的目标父目录位于工作区之外。'],
  ['The proposed target path already exists.', '提议的目标路径已存在。'],
  ['The requested file is blocked by the sensitive-path policy.', '请求的文件被敏感路径策略阻止。'],
  ['The resolved file path is outside the workspace.', '解析后的文件路径位于工作区之外。'],
  [
    'The review digest is stale. Reload the change before approving it.',
    '审核摘要已过期，请重新加载变更后再批准。',
  ],
  [
    'The reviewed change has changed. Reload it before editing.',
    '已审核的变更发生了变化，请重新加载后再编辑。',
  ],
  ['The rollback digest is stale.', '回滚摘要已过期。'],
  ['This change has already been applied.', '该变更已应用。'],
  ['This change set can no longer be edited.', '该变更集已不能再编辑。'],
  ['This change set is not open for review.', '该变更集当前未开放审核。'],
  ['Chat request ID is already active.', '聊天请求 ID 已在使用中。'],
  ['Context token budget must be a positive safe integer.', '上下文令牌预算必须是正的安全整数。'],
  ['Conversation does not belong to the active workspace.', '该会话不属于当前工作区。'],
  ['Conversation not found.', '找不到会话。'],
  ['Conversation title cannot be empty.', '会话标题不能为空。'],
  [
    'Stop the active Agent task before deleting this conversation.',
    '删除会话前请先停止正在运行的智能体任务。',
  ],
  ['The Agent exceeded the maximum number of model rounds.', '智能体已超过模型最大轮次限制。'],
  ['The Agent exceeded the maximum number of tool calls.', '智能体已超过工具最大调用次数。'],
  [
    'Pending tool approval is missing its integrity digest.',
    '待处理的工具批准请求缺少完整性摘要。',
  ],
  ['This conversation already has an active Agent task.', '该会话已有正在运行的智能体任务。'],
  ['This tool call is already waiting for approval.', '该工具调用已在等待批准。'],
  ['This tool request is no longer waiting for approval.', '该工具请求已不再等待批准。'],
  ['The tool approval digest is stale.', '工具批准摘要已过期。'],
  ['Tool approval request was not found.', '找不到工具批准请求。'],
  ['The requested workspace is not the active workspace.', '请求的工作区不是当前工作区。'],
  ['IPC request rejected.', 'IPC 请求已被拒绝。'],
  ['Update has not finished downloading.', '更新尚未下载完成。'],
  ['package.json must contain a JSON object.', 'package.json 必须包含一个 JSON 对象。'],
  [
    '.NET debugging requires a compiled .dll or .exe. Build the project and select that output as the run executable.',
    '.NET 调试需要已编译的 .dll 或 .exe；请构建项目，并选择该输出作为运行可执行文件。',
  ],
  ['netcoredbg was not found on PATH.', '在 PATH 中找不到 netcoredbg。'],
  [
    'LLDB debugging requires a compiled executable. Build the project and select its binary as the run executable.',
    'LLDB 调试需要已编译的可执行文件；请构建项目，并选择其二进制文件作为运行可执行文件。',
  ],
  ['lldb-dap was not found on PATH.', '在 PATH 中找不到 lldb-dap。'],
  ['Go debugging requires a package or executable.', 'Go 调试需要包路径或可执行文件。'],
  ['dlv was not found on PATH.', '在 PATH 中找不到 dlv。'],
  ['The debug adapter has no process ID.', '调试适配器没有有效进程 ID。'],
  [
    'Eclipse JDT Language Server did not expose LSP stdio streams.',
    'Eclipse JDT Language Server 未提供 LSP 标准输入输出流。',
  ],
  ['Java 21 or newer executable was not found.', '找不到 Java 21 或更高版本的可执行文件。'],
  ['JDK 21 or newer was not found.', '找不到 JDK 21 或更高版本。'],
  ['Java language server has no process ID.', 'Java 语言服务器没有有效进程 ID。'],
  [
    'Java language server returned an invalid classpath result.',
    'Java 语言服务器返回了无效的 classpath 结果。',
  ],
  ['Java LSP frame has an invalid Content-Length.', 'Java LSP 消息帧的 Content-Length 无效。'],
  ['Java LSP frame has no Content-Length.', 'Java LSP 消息帧缺少 Content-Length。'],
  ['Java LSP header is too large.', 'Java LSP 消息头过大。'],
  ['Java LSP returned an invalid JSON-RPC message.', 'Java LSP 返回了无效的 JSON-RPC 消息。'],
  ['The bundled JDT LS launcher is missing.', '随应用分发的 JDT LS 启动器缺失。'],
  [
    'The bundled Microsoft Java debug plug-in is missing.',
    '随应用分发的 Microsoft Java 调试插件缺失。',
  ],
  [
    'The Microsoft Java debug server returned an invalid DAP port.',
    'Microsoft Java 调试服务器返回了无效的 DAP 端口。',
  ],
  [
    'Refusing to remove an unexpected Java language server directory.',
    '拒绝删除非预期的 Java 语言服务器目录。',
  ],
  ['Unsupported address family', '不支持的网络地址族。'],
  ['Run execution was not found.', '找不到运行执行记录。'],
  [
    'Run history limit must be an integer between 1 and 1000.',
    '运行历史记录上限必须是 1 到 1000 之间的整数。',
  ],
  [
    'The command snapshot must belong to the execution configuration.',
    '命令快照必须属于对应的执行配置。',
  ],
]);

export const domainChineseRules: ReadonlyArray<readonly [RegExp, MatchTranslator]> = [
  [
    /^(.+) cannot be restored from its snapshot\.$/,
    (match) => `${value(match, 1)} 无法从快照恢复。`,
  ],
  [
    /^(.+) changed after apply; rollback was blocked\.$/,
    (match) => `${value(match, 1)} 在应用后发生变化，回滚已被阻止。`,
  ],
  [
    /^(.+) changed during rollback compensation\.$/,
    (match) => `${value(match, 1)} 在回滚补偿期间发生变化。`,
  ],
  [/^(.+) has no rename destination\.$/, (match) => `${value(match, 1)} 没有重命名目标。`],
  [/^(.+) has no rollback snapshot\.$/, (match) => `${value(match, 1)} 没有回滚快照。`],
  [/^(.+) is no longer reviewable\.$/, (match) => `${value(match, 1)} 已不能再审核。`],
  [
    /^(.+) no longer exists; rollback was blocked\.$/,
    (match) => `${value(match, 1)} 已不存在，回滚已被阻止。`,
  ],
  [
    /^(.+) or its rename target changed; rollback was blocked\.$/,
    (match) => `${value(match, 1)} 或其重命名目标已变化，回滚已被阻止。`,
  ],
  [
    /^(.+) was recreated after apply; rollback was blocked\.$/,
    (match) => `${value(match, 1)} 在应用后被重新创建，回滚已被阻止。`,
  ],
  [
    /^The create proposal for (.+) has no content\.$/,
    (match) => `${value(match, 1)} 的创建提案没有内容。`,
  ],
  [
    /^The proposed artifact for (.+) failed integrity validation\.$/,
    (match) => `${value(match, 1)} 的提议产物未通过完整性校验。`,
  ],
  [
    /^The rename proposal for (.+) has no destination\.$/,
    (match) => `${value(match, 1)} 的重命名提案没有目标。`,
  ],
  [/^The review digest for (.+) is stale\.$/, (match) => `${value(match, 1)} 的审核摘要已过期。`],
  [
    /^The update proposal for (.+) has no content\.$/,
    (match) => `${value(match, 1)} 的更新提案没有内容。`,
  ],
  [
    /^(.+) did not expose DAP stdio streams\.$/,
    (match) => `${value(match, 1)} 未提供 DAP 标准输入输出流。`,
  ],
  [
    /^(.+) did not expose startup output streams\.$/,
    (match) => `${value(match, 1)} 未提供启动输出流。`,
  ],
  [
    /^(.+) reverse request (.+) is not supported\.$/,
    (match) => `${value(match, 1)} 不支持反向请求 ${value(match, 2)}。`,
  ],
  [
    /^There is no executable (.+) target at the cursor\.$/,
    (match) => `当前光标位置没有可执行的 ${value(match, 1)} 调试目标。`,
  ],
  [
    /^Run execution (.+) could not start: (.+)$/s,
    (match) => `运行 ${value(match, 1)} 无法启动：${value(match, 2)}`,
  ],
  [/^Run execution (.+) has already been used\.$/, (match) => `运行 ${value(match, 1)} 已被使用。`],
  [
    /^Run execution (.+) started without a process identifier\.$/,
    (match) => `运行 ${value(match, 1)} 启动后没有有效进程 ID。`,
  ],
  [/^Run execution (.+) was not found\.$/, (match) => `找不到运行 ${value(match, 1)}。`],
  [
    /^The same service is already running as execution (.+)\.$/,
    (match) => `相同服务已在运行 ${value(match, 1)} 中启动。`,
  ],
  [
    /^Sensitive run environment variable (.+) cannot be persisted\.$/,
    (match) => `敏感运行环境变量 ${value(match, 1)} 不能写入持久化记录。`,
  ],
  [
    /^Java debug services could not start: (.+)$/s,
    (match) => `Java 调试服务启动失败：${value(match, 1)}`,
  ],
  [
    /^Java debugging is not supported on (.+)\.$/,
    (match) => `Java 调试不支持 ${value(match, 1)} 平台。`,
  ],
  [
    /^Java LSP frame exceeds (\d+) bytes\.$/,
    (match) => `Java LSP 消息帧超过 ${value(match, 1)} 字节限制。`,
  ],
  [
    /^The bundled JDT LS (.+) configuration is missing\.$/,
    (match) => `随应用分发的 JDT LS ${value(match, 1)} 配置缺失。`,
  ],
  [
    /^Unsupported Java language server request: (.+)$/,
    (match) => `不支持的 Java 语言服务器请求：${value(match, 1)}`,
  ],
  [/^Missing database migration (\d+)\.$/, (match) => `缺少数据库迁移 ${value(match, 1)}。`],
  [/^Tool "(.+)" is already registered\.$/, (match) => `工具“${value(match, 1)}”已注册。`],
  [/^Tool "(.+)" is not registered\.$/, (match) => `工具“${value(match, 1)}”未注册。`],
  [
    /^Provider kind "(.+)" is already registered\.$/,
    (match) => `Provider 类型“${value(match, 1)}”已注册。`,
  ],
  [
    /^Provider kind "(.+)" is not registered\.$/,
    (match) => `Provider 类型“${value(match, 1)}”未注册。`,
  ],
];

function value(match: RegExpMatchArray, index: number): string {
  return match[index] ?? '';
}
