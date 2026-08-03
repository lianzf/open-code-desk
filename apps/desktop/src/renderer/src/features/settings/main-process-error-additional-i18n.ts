type MatchTranslator = (match: RegExpMatchArray) => string;

export const additionalExactEnglish = new Map<string, string>([
  [
    '更新检查仅在已安装的正式版本中可用。',
    'Update checking is only available in an installed production build.',
  ],
  ['任务执行计划不能包含重复任务。', 'A task execution plan cannot contain duplicate tasks.'],
  ['根任务不在执行计划中。', 'The root task is missing from the execution plan.'],
  ['找不到项目任务执行记录。', 'The project task execution no longer exists. Refresh the history.'],
  [
    '应用在任务完成前关闭。请重新运行该任务。',
    'The app closed before the task finished. Run the task again.',
  ],
  ['项目任务不属于当前工作区。', 'The project task does not belong to the current workspace.'],
  ['项目任务不能依赖自身。', 'A project task cannot depend on itself.'],
  [
    '项目任务依赖必须属于当前工作区。',
    'Project task dependencies must belong to the current workspace.',
  ],
  ['项目任务依赖形成循环。', 'The project task dependencies contain a cycle.'],
  ['项目任务不能移动到其他工作区。', 'A project task cannot be moved to another workspace.'],
  [
    '组合运行配置不能移动到其他工作区。',
    'A compound run configuration cannot be moved to another workspace.',
  ],
  [
    '组合运行至少需要两个不同的运行配置。',
    'A compound run requires at least two different run configurations.',
  ],
  [
    '组合中的运行配置不属于当前工作区或已被删除。',
    'A run configuration in the compound is outside this workspace or was deleted.',
  ],
  [
    '找不到当前工作区的组合运行配置。',
    'No compound run configuration exists in the current workspace.',
  ],
  [
    '找不到当前工作区的组合运行会话。',
    'The compound run session no longer exists. Refresh the list.',
  ],
  ['运行配置不属于当前工作区。', 'The run configuration does not belong to the current workspace.'],
  ['找不到当前工作区的运行配置。', 'No run configuration exists in the current workspace.'],
  [
    '无法为复制的运行配置生成唯一名称。',
    'A unique name could not be generated for the copied run configuration.',
  ],
  ['运行配置不能移动到其他工作区。', 'A run configuration cannot be moved to another workspace.'],
  [
    '默认运行配置必须属于当前工作区。',
    'The default run configuration must belong to the current workspace.',
  ],
  [
    '找不到要接收调试上下文的会话。',
    'The conversation selected for debug context no longer exists.',
  ],
  [
    '调试上下文只能发送到同一工作区的会话。',
    'Debug context can only be sent to a conversation in the same workspace.',
  ],
  ['调试上下文预览已过期，请重新收集。', 'The debug context preview expired. Collect it again.'],
  ['调试上下文预览已变化，请重新审核。', 'The debug context preview changed. Review it again.'],
  [
    '调试上下文预览与当前会话不匹配。',
    'The debug context preview does not match the current conversation.',
  ],
  [
    '程序暂停位置已变化，请重新收集调试上下文。',
    'The paused location changed. Collect the debug context again.',
  ],
  ['所选调试上下文包含无效分区。', 'The selected debug context contains an invalid section.'],
  ['只有程序暂停时才能收集调试上下文。', 'Pause the program before collecting debug context.'],
  [
    '调试命令快照与运行配置不匹配。',
    'The debug command snapshot does not match the run configuration.',
  ],
  [
    '调试命令快照不得保存敏感环境变量明文。',
    'A debug command snapshot cannot store plaintext sensitive environment values.',
  ],
  ['调试历史数量必须在 1 到 1000 之间。', 'The debug history limit must be between 1 and 1000.'],
  [
    '应用关闭前调试会话尚未结束，请重新启动调试。',
    'The app closed before debugging finished. Start the debug session again.',
  ],
  ['调试器返回了无法识别的错误。', 'The debugger returned an unrecognized error.'],
  [
    'Node.js 调试适配器资源不可用，请重新安装 OpenCode Desk。',
    'The Node.js debug adapter is unavailable. Reinstall OpenCode Desk.',
  ],
  [
    'Python 调试适配器资源不可用，请重新安装 OpenCode Desk。',
    'The Python debug adapter is unavailable. Reinstall OpenCode Desk.',
  ],
  ['运行配置缺少可执行程序。', 'The run configuration is missing an executable.'],
  [
    '远程或容器附加调试当前仅支持 Node.js 兼容项目类型。',
    'Remote or container attach debugging currently requires a Node.js-compatible project type.',
  ],
  [
    '该配置用于附加远程或容器调试目标，不能作为普通运行配置启动。',
    'This configuration attaches to a remote or container debug target and cannot be started as a normal run.',
  ],
  [
    'Node.js 附加调试缺少远程或容器目标。',
    'Node.js attach debugging is missing a remote or container target.',
  ],
  [
    'Electron 调试配置缺少渲染进程调试端口。',
    'The Electron debug configuration is missing a renderer debug port.',
  ],
  [
    'Electron 配置必须指定渲染进程调试端口。',
    'Electron configurations must specify a renderer debug port.',
  ],
  [
    '该配置将通过自定义运行时启动，调试结果取决于运行时是否创建 Node.js 进程。',
    'This configuration uses a custom runtime; debugging requires it to create a Node.js process.',
  ],
  [
    'Python 调试配置必须选择 python、python3 或虚拟环境中的 Python 可执行文件。',
    'Select python, python3, or a Python executable from a virtual environment.',
  ],
  [
    '当前解释器依赖系统 PATH；为避免 IDE 重启后选错环境，建议选择自动发现的绝对路径。',
    'This interpreter depends on PATH. Select an auto-discovered absolute path to keep the environment stable after restart.',
  ],
  [
    'Python 调试暂不支持 -c 内联代码，请改用工作区内脚本文件。',
    'Python debugging does not support inline -c code. Use a script file in the workspace.',
  ],
  ['Python -m 参数后缺少模块名称。', 'The Python -m argument is missing a module name.'],
  [
    'Python 调试配置缺少脚本文件；请在程序参数第一行填写入口文件。',
    'The Python debug configuration is missing a script. Put the entry file first in the program arguments.',
  ],
  [
    '端口对应的运行记录不属于当前工作区。',
    'The run record for this port does not belong to the current workspace.',
  ],
]);

export const additionalEnglishRules: ReadonlyArray<readonly [RegExp, MatchTranslator]> = [
  [
    /^Electron 渲染进程调试端口 (.+) 已被占用；为避免附加到非本会话目标，请更换端口。$/,
    (match) =>
      `Electron renderer debug port ${value(match, 1)} is already in use. Choose another port to avoid attaching to a target outside this session.`,
  ],
  [
    /^Electron 未在 (\d+) 毫秒内开放渲染进程调试端口 (.+)。$/,
    (match) =>
      `Electron did not open renderer debug port ${value(match, 2)} within ${value(match, 1)} ms.`,
  ],
  [
    /^敏感任务环境变量 (.+) 不得写入执行历史。$/,
    (match) =>
      `Sensitive task environment variable ${value(match, 1)} cannot be stored in execution history.`,
  ],
  [
    /^敏感任务环境变量 (.+) 不得保存明文。$/,
    (match) =>
      `Sensitive task environment variable ${value(match, 1)} cannot be stored in plaintext.`,
  ],
  [
    /^敏感任务环境变量 (.+) 的凭据引用无效。$/,
    (match) =>
      `Sensitive task environment variable ${value(match, 1)} has an invalid credential reference.`,
  ],
  [
    /^任务环境变量 (.+) 的存储状态无效。$/,
    (match) => `Task environment variable ${value(match, 1)} has an invalid storage state.`,
  ],
  [
    /^任务环境变量 (.+) 重复。$/,
    (match) => `Task environment variable ${value(match, 1)} is duplicated.`,
  ],
  [
    /^任务“(.+)”仍依赖该任务，请先移除依赖。$/,
    (match) => `Task “${value(match, 1)}” still depends on this task. Remove the dependency first.`,
  ],
  [
    /^运行配置“(.+)”仍引用该任务。$/,
    (match) => `Run configuration “${value(match, 1)}” still references this task.`,
  ],
  [
    /^敏感运行环境变量 (.+) 不得保存明文值。$/,
    (match) =>
      `Sensitive run environment variable ${value(match, 1)} cannot be stored in plaintext.`,
  ],
  [
    /^敏感运行环境变量 (.+) 的凭据引用状态无效。$/,
    (match) =>
      `Sensitive run environment variable ${value(match, 1)} has an invalid credential reference.`,
  ],
  [
    /^非敏感运行环境变量 (.+) 不得保存凭据引用。$/,
    (match) =>
      `Non-sensitive run environment variable ${value(match, 1)} cannot store a credential reference.`,
  ],
  [
    /^非敏感运行环境变量 (.+) 的配置状态无效。$/,
    (match) =>
      `Non-sensitive run environment variable ${value(match, 1)} has an invalid configuration state.`,
  ],
  [
    /^(.+)任务不属于当前工作区或已被删除。$/,
    (match) => `The ${value(match, 1)} task is outside the current workspace or was deleted.`,
  ],
  [
    /^无法识别 Python 调试入口 (.+)；脚本入口不能是选项。$/,
    (match) =>
      `Python debug entry ${value(match, 1)} is invalid; a script entry cannot be an option.`,
  ],
];

export const additionalExactChinese = new Map<string, string>([
  [
    'The Electron debug configuration is missing the Electron executable.',
    'Electron 调试配置缺少 Electron 可执行程序。',
  ],
  [
    'Electron debugging requires a renderer debug port in the run configuration.',
    'Electron 调试要求在运行配置中填写渲染进程调试端口。',
  ],
  [
    'Electron main-process output is shown in the debug console.',
    'Electron 主进程输出会显示在调试控制台中。',
  ],
  [
    'Electron debugging opens a loopback-only Chromium DevTools endpoint for the renderer process.',
    'Electron 调试会为渲染进程开放仅限本机回环的 Chromium DevTools 端点。',
  ],
  [
    'The bundled JavaScript debug adapter is unavailable. Reinstall OpenCode Desk.',
    '随应用分发的 JavaScript 调试适配器不可用，请重新安装 OpenCode Desk。',
  ],
  [
    'Chrome or Microsoft Edge was not found. Install a supported Chromium browser.',
    '未找到 Chrome 或 Microsoft Edge，请安装受支持的 Chromium 浏览器。',
  ],
  ['Chrome or Microsoft Edge was not found.', '未找到 Chrome 或 Microsoft Edge。'],
  [
    'The browser debug configuration is missing a development server executable.',
    '浏览器调试配置缺少开发服务器可执行程序。',
  ],
  [
    'Browser debugging requires the development server port in the run configuration.',
    '浏览器调试要求在运行配置中填写开发服务器端口。',
  ],
  ['Browser debugging requires a development server port.', '浏览器调试需要开发服务器端口。'],
  [
    'The approved development server output is shown in the debug console during browser debugging.',
    '浏览器调试期间，已批准的开发服务器输出会显示在调试控制台中。',
  ],
  ['The browser development server has no process ID.', '浏览器开发服务器没有有效进程 ID。'],
  [
    'The browser development server did not expose output streams.',
    '浏览器开发服务器未提供输出流。',
  ],
  [
    'Java debugging requires JDK 21 or newer for JDT LS. Set JDTLS_JAVA_HOME or JAVA_HOME to a JDK 21+ installation.',
    'Java 调试需要 JDK 21 或更高版本来运行 JDT LS；请将 JDTLS_JAVA_HOME 或 JAVA_HOME 指向 JDK 21+。',
  ],
  [
    'The bundled Eclipse JDT Language Server is missing; reinstall OpenCode Desk.',
    '随应用分发的 Eclipse JDT Language Server 缺失，请重新安装 OpenCode Desk。',
  ],
  [
    'The bundled Microsoft Java debug server is missing; reinstall OpenCode Desk.',
    '随应用分发的 Microsoft Java 调试服务器缺失，请重新安装 OpenCode Desk。',
  ],
  [
    'Java debug configuration must put the fully qualified main class first.',
    'Java 调试配置必须把完全限定主类名放在程序参数第一项。',
  ],
  [
    'Java -jar debugging is not supported yet; select a project main class.',
    'Java 调试暂不支持 -jar，请选择项目主类。',
  ],
  [
    'No Java main class was found. Wait for project import to finish and ensure the project has public static void main(String[] args).',
    '未找到 Java 主类；请等待项目导入完成，并确认项目包含 public static void main(String[] args)。',
  ],
  [
    'Java language server returned an empty runtime classpath.',
    'Java 语言服务器返回了空的运行时 classpath。',
  ],
  [
    'Terminal session was not found or belongs to another window.',
    '找不到终端会话，或该会话属于其他窗口。',
  ],
  [
    'The Agent task was cancelled while waiting for command approval.',
    '智能体任务在等待命令批准时已取消。',
  ],
  ['The command was cancelled by the user.', '命令已被用户取消。'],
  ['The command exceeded the 1 MB output safety limit.', '命令输出超过 1 MB 安全限制。'],
  ['Command execution was not found.', '找不到命令执行记录。'],
  [
    'The application closed before this command completed. Run it again if needed.',
    '应用在命令完成前关闭；如有需要，请重新运行。',
  ],
  ['This command is no longer waiting for approval.', '该命令已不再等待批准。'],
  ['The command approval digest is stale.', '命令批准摘要已过期，请重新审核。'],
  [
    'The Agent task that requested this command is no longer active.',
    '请求此命令的智能体任务已不再活动。',
  ],
  ['The user rejected the command proposal.', '用户已拒绝该命令。'],
  ['The command approval was cancelled.', '命令批准已取消。'],
  [
    'The command working directory is outside the workspace or not a directory.',
    '命令工作目录不在当前工作区内，或该路径不是目录。',
  ],
  [
    'The executable is on the workspace command deny list.',
    '该可执行文件位于工作区命令拒绝列表中。',
  ],
]);

export const additionalChineseRules: ReadonlyArray<readonly [RegExp, MatchTranslator]> = [
  [
    /^Electron debugging does not support project type (.+)\.$/,
    (match) => `Electron 调试不支持 ${value(match, 1)} 项目类型。`,
  ],
  [
    /^Browser debugging does not support project type (.+)\.$/,
    (match) => `浏览器调试不支持 ${value(match, 1)} 项目类型。`,
  ],
  [
    /^Java debugger does not support project type (.+)\.$/,
    (match) => `Java 调试器不支持 ${value(match, 1)} 项目类型。`,
  ],
  [
    /^Multiple Java main classes were found \((.+)\)\..+$/,
    (match) =>
      `找到多个 Java 主类（${value(match, 1)}）；请创建直接 Java 运行配置，并把目标类放在程序参数第一项。`,
  ],
  [
    /^Java workspace build failed with status (.+)\.$/,
    (match) => `Java 工作区编译失败，状态码为 ${value(match, 1)}。`,
  ],
  [
    /^Java debug services could not start: (.+)$/s,
    (match) => `Java 调试服务启动失败：${value(match, 1)}`,
  ],
  [
    /^Browser debug port (\d+) is already in use\. Stop its current service or choose another port\.$/,
    (match) => `浏览器调试端口 ${value(match, 1)} 已被占用，请停止当前服务或选择其他端口。`,
  ],
  [
    /^The browser development server exited before port (\d+) became ready\.(?: Last output: (.*))?$/s,
    (match) => `浏览器开发服务器在端口 ${value(match, 1)} 就绪前退出。${optionalOutput(match, 2)}`,
  ],
  [
    /^The browser development server did not listen on 127\.0\.0\.1:(\d+) within (\d+) ms\.(?: Last output: (.*))?$/s,
    (match) =>
      `浏览器开发服务器未能在 ${value(match, 2)} 毫秒内监听 127.0.0.1:${value(match, 1)}。${optionalOutput(match, 3)}`,
  ],
  [
    /^The command exceeded its (\d+) ms timeout\.$/,
    (match) => `命令超过 ${value(match, 1)} 毫秒超时限制。`,
  ],
  [/^The command exited with code (.+)\.$/, (match) => `命令退出，退出码为 ${value(match, 1)}。`],
  [/^The command was blocked by policy: (.+)$/, (match) => `命令已被策略阻止：${value(match, 1)}`],
];

function value(match: RegExpMatchArray, index: number): string {
  return match[index] ?? '';
}

function optionalOutput(match: RegExpMatchArray, index: number): string {
  const output = value(match, index);
  return output === '' ? '' : ` 最后输出：${output}`;
}
