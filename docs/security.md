# OpenCode Desk 安全设计

> 状态：阶段 E 高级断点与异常策略安全基线
> 日期：2026-08-02
> 原则：模型输出不可信、最小权限、默认拒绝、审批与执行内容一致

## 1. 安全目标

OpenCode Desk 处理本地源码、模型凭据、终端和任意第三方模型端点。安全目标是：

1. 模型及其返回内容不能直接获得本地执行能力。
2. Renderer 被攻陷时不能直接读取文件、密钥、数据库或执行命令。
3. 所有本地访问限制在用户选定工作区及明确授权范围内。
4. API Key、认证 Header 和系统凭据不以明文进入 SQLite、日志、Renderer、崩溃报告或仓库。
5. 写文件、删除、命令和工作区外访问有清晰、不可重放的用户审批。
6. AI 产生的修改可审阅、可追踪、冲突检测和尽可能回滚。
7. 自定义 Provider 不能借配置绕过网络策略或泄漏其他 Provider 的密钥。

不承诺对已完全控制用户操作系统账户的攻击者保护明文运行时内存，也不绕过操作系统原有权限。

## 2. 信任边界与威胁模型

| 组件/输入              | 信任级别     | 主要威胁                                       |
| ---------------------- | ------------ | ---------------------------------------------- |
| 模型响应、工具调用参数 | 不可信       | Prompt injection、命令注入、越权读写、资源耗尽 |
| 工作区源码与 Markdown  | 不可信       | 恶意指令、巨型文件、软链接逃逸、渲染 XSS       |
| Renderer/Web 内容      | 低信任       | XSS 后调用高权限 IPC、敏感信息外传             |
| Preload                | 高敏边界     | 暴露过宽 API、原型污染、缺少参数校验           |
| Electron 主进程        | 高信任       | confused deputy、路径/命令/网络策略缺陷        |
| 自定义 Provider URL    | 不可信配置   | SSRF、明文 HTTP、中间人、重定向泄密            |
| SQLite/Artifact/日志   | 本地敏感数据 | 源码、对话、命令输出和元数据泄漏               |
| 系统凭据库             | 最高敏感     | 密钥读取、错误回显、错误账户/服务命名          |
| 第三方依赖与更新包     | 供应链边界   | 恶意包、安装脚本、未签名更新                   |

主要攻击场景：

- 仓库内文件指示模型读取 `.env`、SSH 私钥或工作区外文件。
- 模型伪造工具调用，尝试 `../../`、软链接、UNC 路径或大小写绕过。
- 模型把破坏性命令伪装为测试命令，或使用 shell 元字符拼接第二条命令。
- Renderer XSS 尝试枚举通用 IPC 或读取 Provider Secret。
- 自定义 Provider 重定向到另一个 Host 后携带 Authorization。
- 日志、异常、遥测或请求调试意外输出密钥和源码。
- 应用写文件期间崩溃，造成部分更新或丢失用户并发编辑。

## 3. Electron 安全基线

BrowserWindow 必须满足：

```ts
const windowOptions: Electron.BrowserWindowConstructorOptions = {
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: preloadPath,
  },
};
```

同时执行：

- 生产环境只加载打包的本地页面，不加载不可信远程页面。
- 禁用 `eval`、`new Function` 和动态执行模型生成代码。
- 拒绝所有非白名单 `window.open`、导航、权限请求和 WebView。
- 不启用 `remote`；不向 Renderer 暴露 `ipcRenderer`、路径、进程或文件句柄。
- CSP 至少限制 `default-src 'self'`，脚本不得使用 `unsafe-eval`；开发和生产策略分离。
- Monaco Worker 使用本地资源和显式 `worker-src`，不得为了方便放宽整个 CSP。
- Markdown 默认禁用原始 HTML；链接协议只允许 `http:`, `https:`，外部打开前确认。
- DevTools 生产默认关闭，仅通过明确的开发开关启用。
- 所有 IPC sender 校验来源窗口、Frame 和预期 URL；窗口销毁后取消订阅。

## 4. 类型安全 IPC

每个通道拥有请求与响应 Zod Schema，handler 按模块注册：

```text
workspace.ipc.ts
files.ipc.ts
git.ipc.ts
terminal.ipc.ts
providers.ipc.ts
conversations.ipc.ts
permissions.ipc.ts
agent.ipc.ts
```

IPC 安全规则：

1. 使用固定通道枚举，禁止 Renderer 提交任意方法名或模块名。
2. 入口、Repository 边界和外部 Provider 响应分别校验，不能只依赖 TypeScript。
3. 拒绝未知字段，限制字符串、数组、消息、Diff 和输出的最大长度。
4. IPC DTO 不包含 API Key、Secret 值、绝对 Artifact 路径或原始异常。
5. 事件订阅使用不可预测的 `subscriptionId`，绑定窗口和任务；取消时释放监听器。
6. 错误经过 `AppError` 映射，只向 UI 返回必要详情和可关联的 `causeId`。
7. 审批请求回传 `expectedInputDigest`，执行前与服务端保存值恒时比较。
8. Renderer 不能决定自身权限等级；权限等级来自注册过的 Tool metadata。

## 5. 凭据与敏感配置

### 5.1 SecretStore

通过端口隔离系统凭据能力：

```ts
export interface SecretStore {
  set(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  has(ref: string): Promise<boolean>;
  delete(ref: string): Promise<boolean>;
}
```

Renderer API 不提供 `get`。ProviderService 在主进程发起请求前，使用仅 Infrastructure 可见的内部
读取接口解析 Secret，使用后不写入 Renderer 或应用状态。

当前 Adapter 使用 Electron `safeStorage` 的异步接口：Windows 由 DPAPI 保护加密密钥，macOS
由 Keychain 保护加密密钥，Linux 使用 Secret Service/KWallet。加密后的二进制密文保存在
`secure_secrets` 表，`provider_configs` 只保存不透明引用；API Key 和敏感 Header 明文均不进入
SQLite。Linux 若检测到 `basic_text` 或未知后端会拒绝保存。若系统安全凭据能力不可用：

- 阻止保存 Provider 配置并给出可读错误。
- 可以允许用户选择仅本次会话保存在进程内存中。
- 不得回退到 localStorage、普通 JSON、环境文件或 SQLite 明文字段。

### 5.2 自定义 Header

Header 分为非敏感和敏感两类。`Authorization`、`Proxy-Authorization`、`Cookie`、名称含
`api-key`、`token`、`secret` 的字段强制视为敏感，值进入 SecretStore。用户标记的其他敏感
Header 同样处理。数据库只保存 Header 名、是否敏感和值引用；值只存在于系统保护的加密载荷中。

应用禁止用户覆盖下列运行时 Header：`Host`、`Content-Length`、`Connection` 和由 HTTP 客户端
管理的 Hop-by-hop Header。日志脱敏器按 Header 名和已知 Secret 值双重处理。

### 5.3 生命周期

- 创建：先写 SecretStore，再写数据库引用；数据库失败则删除新 Secret。
- 更新：使用新引用写入，数据库提交后删除旧引用。
- 删除：删除数据库配置与 Secret 需要补偿事务；失败时显示残留清理状态。
- 测试连接：不回显请求 Header、完整响应体或带凭据 URL。
- 导出/备份：默认排除 Secret；导入后要求重新输入。

## 6. 工作区与文件系统安全

### 6.1 路径判定

每次文件操作都执行：

1. 要求请求的工作区 ID 与主进程当前显式打开的工作区一致；最近工作区数据库记录本身不授予访问权。
2. 对用户工作区根目录执行绝对化和真实路径解析，保存 canonical root。
3. 拒绝空字节、非法设备名、超长输入和不支持的 URI Scheme。
4. 将相对路径解析到 root；默认拒绝绝对路径。
5. 解析目标已存在的最近父目录真实路径，处理新建文件场景。
6. 使用平台感知、带路径分隔符的比较确认目标位于 root 内。
7. 遍历路径段检查软链接、junction/reparse point；解析后再次校验。
8. 打开文件后通过句柄/最终路径复验，缩小 TOCTOU 窗口。
9. 写入前和重命名后再次校验目标。

不能仅用字符串 `startsWith(root)`；Windows 比较需要处理盘符、大小写、UNC、短文件名和
reparse point。跨卷路径不使用 rename 伪装原子操作。

### 6.2 敏感路径策略

自动发现和只读工具默认拒绝：

- `.env`、`.env.*`（可允许明确的 `.env.example`）。
- `.ssh/`、私钥常见文件名、GPG/证书私钥。
- 浏览器 Profile、Cookie、Login Data、系统凭据目录。
- `.aws/credentials`、云 CLI token、npm/pip/registry 凭据。
- OS 用户目录中的钥匙串、Credential 数据或备份。
- 工作区内由用户配置的额外禁止规则。

项目规则文件和 README 永远只作为不可信上下文，不赋予权限。`.env`、SSH/GPG 私钥、浏览器
凭据目录、系统凭据目录和受保护系统路径属于硬拒绝范围，不能通过普通权限规则放行。

用户可以增加工作区相对路径禁止规则。该规则同时约束 Renderer 文件操作、Agent 只读工具和
FileChange 提案/应用时的再次解析；目录树只显示为受限项，不自动进入搜索或上下文。

### 6.3 资源限制

- 文件读取、搜索结果、目录深度、文件数量和单文件大小有上限。
- 默认跳过二进制、`.git`、`node_modules`、构建产物和用户忽略目录。
- 文本解码失败返回明确错误，不猜测并损坏二进制文件。
- 文件写入保留原权限，创建文件使用限制性权限，并拒绝特殊设备/FIFO。

### 6.4 工作区外目录授权

工作区外访问不接受模型提供的绝对路径，也不提供全局“允许访问主目录”开关。授权流程为：

1. 用户通过 Electron 系统目录选择器选择一个具体目录。
2. 主进程解析 canonical path，拒绝敏感凭据目录和受保护系统目录。
3. SQLite 只保存该工作区下的 `external_directory` 规则和 canonical path。
4. Agent 先通过 `list_external_grants` 获取不透明 grant ID 和目录标签。
5. `list_external_directory`、`read_external_file` 只接受 grant ID 与相对路径。
6. 每次外部目录列举或文件读取仍生成独立工具审批，请求绑定已通过 Zod 校验的参数摘要。
7. 执行前重新解析授权根和目标真实路径，拒绝 symlink/junction 逃逸、敏感文件和超过 2 MB 的文件。

撤销规则后 grant ID 立即失效。应用重启时未完成的工具审批标记为取消，不会静默恢复执行。

## 7. AI 文件修改安全

模型只可提交结构化 `FileChange` 提议，不能调用无审阅的通用写文件能力。控制包括：

- 保存原始内容哈希与文件元数据，Diff 显示完整目标路径和操作类型。
- 删除、重命名、二进制修改和大文件修改单独标记高风险。
- 用户编辑 proposed content 后审批失效并生成新摘要。
- 应用时校验审批、内容摘要、基线哈希、工作区和任务仍一致。
- 持久化的原始/拟议内容放在用户数据目录下的私有 Artifact Store，以 SHA-256 引用；SQLite
  不保存完整文件正文。
- 为保证同文件系统原子替换，短生命周期的临时文件和 backup 使用目标同目录的随机隐藏名称；
  写入后 `fsync`，事务完成或补偿后清理，且不跟随符号链接。
- 写临时文件、刷新磁盘、原子替换；多文件先统一校验，再使用快照和 Saga 补偿回滚。
- 回滚同样检查当前哈希，避免覆盖应用后用户的新修改。
- 数据库记录变更元数据，审计记录不默认包含完整源码。

“批准全部”只覆盖当前可见且摘要固定的 ChangeSet；后续新增文件不能继承批准。

## 8. 命令与终端安全

### 8.1 AI 命令

模型返回的普通文本绝不能执行。`run_command` 只接受结构化参数：

```ts
interface RunCommandInput {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly shellMode: false;
}
```

MVP 默认使用 `spawn(executable, args, { shell: false })`，不接受拼接后的命令字符串。审批 UI 显示
解析后的可执行文件、每个参数、规范化 cwd、超时和环境变量名称。仅传最小环境变量集合，剔除
Provider Secret 和应用内部变量。

下列行为至少标为 dangerous，并需要专门确认或直接拒绝：

- `sudo`、`su`、提权工具和系统服务修改。
- 磁盘格式化、分区、引导配置、注册表关键路径。
- 递归删除工作区根或工作区外路径。
- 下载后执行、PowerShell encoded command、隐藏窗口持久化。
- 修改系统凭据、安全策略、防火墙或启动项。
- 命令解释器 `-c`/`/c`、shell 元字符、重定向与管道。

包管理器脚本可能间接执行任意代码，不能因为命令名是 `test` 就自动信任。允许规则精确匹配规范化的
executable、完整参数数组、cwd 和工作区；旧版本缺少参数的允许规则按失败关闭处理。拒绝规则可以只按
executable 与 cwd 宽泛阻断。网络命令还必须同时满足独立的工作区网络授权。

### 8.2 交互终端

用户主动操作的集成终端与 Agent 工具分开：

- Renderer 只收发 PTY 数据和尺寸，不获得进程对象。
- PTY 创建仍限制 cwd 为工作区，Session 有唯一 ID 和拥有窗口。
- 用户键入内容不等同于 AI 获得执行权限。
- Agent 若建议向终端发送内容，必须转成新的命令审批，不注入用户 PTY。
- 关闭窗口或取消任务时终止进程树，并在超时后强制清理。

### 8.3 IDE 项目运行

- 检测到的脚本和入口只生成建议，不自动执行；每次启动都创建新的待审批执行记录。
- 审批摘要绑定配置版本、executable、runtime args、args、规范化工作目录、公开环境元数据、
  环境文件 SHA-256 和风险原因；任一内容变化都使批准失效。
- 运行时只使用 `spawn(executable, args, { shell: false })`，工作目录必须通过 canonical workspace
  边界检查，禁止提权、shell 拼接和已阻断的高风险模式。
- 敏感环境变量仅在主进程执行前从 `SecureSecretStore` 解密，既不回传 Renderer，也不进入
  `run_executions`；输出持久化前会按实际 Secret 值脱敏并执行字节上限。
- PID 只用于展示和清理本应用创建的进程；停止、重新运行与退出清理不能终止未归属的系统进程。
- 端口检查先重新解析当前占用 PID；终止外部占用者需要用户确认、期望 PID 匹配和执行前复核，未知进程、自身进程或占用者变化一律拒绝。
- ProjectTask 依赖和运行/调试钩子先展开为不可变计划并整体审批；组合运行通过一份批量提案展示全部子命令，各子进程仍由独立 supervisor 拥有和清理。
- DAP 调试必须采用独立协议会话和权限边界，不能把普通项目运行当作断点调试。
- 输出经过大小限制和敏感值脱敏后才进入日志或上下文。

### 8.4 DAP 调试安全

- 调试开始与普通运行一样先形成不可变 `RunCommandSnapshot`，审批摘要绑定配置、executable、参数、
  工作目录、公开环境元数据、环境文件摘要与风险；配置变化后必须重新审批。
- Node/Python Adapter 使用参数数组和 `shell: false` 启动官方 js-debug/debugpy 与被调试程序；浏览器
  Provider 以同一受控边界启动已审批的前端开发服务器，只等待声明的 `127.0.0.1` 端口，并优先从
  标准绝对安装路径解析 Chrome/Edge，再由固定 js-debug 使用隔离 Profile 启动和清理整棵浏览器
  进程。外部 LLDB/Delve/NetCoreDbg Provider 只解析 PATH 中的明确可执行文件，以 `shell: false`
  启动，Delve 仅监听 `127.0.0.1` 随机端口。Java Provider 以 `shell: false` 启动 JDK 21+ 与固定
  JDT LS，通过 stdio LSP 加载固定 Java Debug Server 插件，再连接插件返回的 `127.0.0.1` DAP 端口；
  每个会话使用应用拥有的随机临时数据目录。工作
  目录、program、runtime executable 和所有源码路径均经过规范化及工作区边界校验，不接受未注册
  的适配器类型。
- Electron Provider 只接受进入不可变审批摘要的 executable、参数和渲染调试端口；启动前确认端口未被占用，再显式注入 `--remote-debugging-address=127.0.0.1` 与获批端口。主进程使用 `pwa-node`，渲染进程使用第二个 `pwa-chrome` 客户端；两侧 DAP ID 被隔离，渲染目标断开不会冒充整个应用退出。停止会话会清理本应用启动的 Electron 进程，且不会附加到启动前已存在的端口。
- 调试进程只继承受控最小环境；敏感环境变量在主进程最后一刻解析，不写入 Renderer、SQLite、
  DAP 审计元数据或公开错误。
- Node Inspector 附加目标只接受经 Schema 校验的主机、端口和绝对 `remoteRoot`；端点进入不可变审批
  摘要。回环或本机转发目标为中风险，直接非回环连接为高风险并显示远程调试端口可控制目标程序的
  警告。应用不自动执行 SSH、Docker 或容器命令，也不把本地环境值写入 `attach` 请求。
- attach 会话只拥有本机 js-debug Adapter，断开时显式使用 `terminateDebuggee=false`；远程或容器内
  目标不进入本机 PID 清理路径。用户必须自行建立、限制和撤销端口转发。
- adapter output、stdout/stderr、异常消息、异常堆栈、变量值与表达式结果在进入 UI、数据库或未来
  AI 上下文前统一应用已知 Secret 脱敏和长度上限。遥测类 DAP 输出不会被当作可信控制指令。
- Renderer 无法直接连接 DAP socket/stdio；所有控制和查询都通过 preload 最小 API 与独立
  `debug.ipc.ts`，请求和响应由 Zod 严格校验。未知字段、负数 reference、越界路径和过长表达式被拒绝。
- 会话只控制自身拥有的 adapter/debuggee 进程。停止、重启、协议终止、适配器崩溃和应用退出都会
  进入幂等清理；PID 不构成终止任意系统进程的授权。
- 持久化只保存断点位置、监视表达式、受限输出尾部、暂停快照和会话元数据；不持久化完整变量树或
  敏感环境值。恢复历史不自动恢复进程或重放调试命令。
- 内置 Adapter 仅加载固定版本 `vscode-js-debug 1.117.0`、`debugpy 1.8.21`、JDT LS 1.60.0 和
  Java Debug Server 0.53.2。仓库记录来源、许可证和
  分发文件 SHA-256；debugpy universal wheel 摘要为
  `b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92`，升级需重新核验。
- `lldb-dap`、`dlv` 和 `netcoredbg` 不随应用下载或分发；缺失时调试提案失败关闭。运行配置仍须通过
  工作区路径、目标类型和存在性校验，构建命令应放入独立、可审核的 pre-debug ProjectTask。
- Python 解释器发现只检查工作区固定虚拟环境路径、当前环境引用和 PATH 文件，不递归扫描用户主
  目录，也不为显示版本而执行解释器。`pyvenv.cfg` 读取限制为 32 KiB；建议配置不会自动执行。
- debugpy 由应用只读资源提供，不通过 `pip install` 修改用户项目。真正启动用户选择的解释器仍需
  经过绑定 executable/args/cwd/env 的调试审批；适配器只监听 `127.0.0.1` 的随机端口。
- Java 调试器不会下载 JDK、修改 PATH/注册表或向项目安装依赖。JDT LS 运行时只从显式候选、
  `JDTLS_JAVA_HOME`、`JAVA_HOME`、PATH 和标准 JDK 安装目录发现，并验证主版本至少为 21。
- “交给 AI 分析”是用户显式动作。主进程先收集、裁剪并脱敏，再让用户逐分区预览；未点击确认时
  不创建会话上下文、不调用 Provider，也不把原始 DAP 数据返回 Renderer。
- 内存缓存只保存已脱敏快照，10 分钟过期并限制数量。摘要绑定 session、workspace、conversation、
  暂停指纹和分区内容；摘要不符、跨工作区、跨会话、非 paused 状态或暂停位置改变均拒绝附加。
- 用户确认后只将所选分区作为 `diagnostic` ContextItem 保存。SQLite 不保存未选择分区、完整变量树、
  原始异常或原始运行时 Secret；审计只记录分区数和脱敏计数。
- 调试上下文在 Agent 系统提示中明确标记为不可信数据。项目源码、异常、日志或变量中的 Prompt
  injection 不能改变工具权限；AI 修复仍只能创建待审核 FileChange，不能自动写入、执行或重启。
- 条件、命中次数和日志断点内容是用户控制的 DAP 数据，只能在已有、已批准的调试会话中由主进程
  发送给 Adapter；它们不会经过 Shell，不会被转换为系统命令，也不会自动由模型创建。
- 高级断点 IPC 对表达式和日志消息设置长度上限并拒绝未知字段。断点路径继续执行工作区边界校验；
  Adapter 返回的验证错误只作为不可信、限长文本展示。
- 异常暂停基础策略仅允许 `none`、`uncaught`、`all`；指定/忽略类型经过数量、长度、去重和 IPC 校验并按 workspace ID 持久化。Node 条件中的类型名使用 JSON 字符串转义；Python 用标准 DAP `exceptionOptions` 设置正向规则，忽略规则则在暂停后通过 `exceptionInfo` 校验类型并自动继续。两条路径均不会进入 Shell；识别或继续失败时保守地保留暂停。
- 函数/数据断点只在 Adapter 明确声明能力时发送对应 DAP 请求；不支持时保留未验证状态，不能用 UI 图标冒充真实断点。
- 日志断点输出与普通调试输出共用敏感值脱敏和长度上限，持久化前不会绕过现有输出策略。

## 9. Provider 网络安全

- 默认只允许 `https:`；`http:` 仅允许用户明确确认的本地开发/Ollama 地址。
- Base URL 使用 URL Parser 规范化，禁止 URL 中嵌入用户名和密码。
- DNS 解析后检查 loopback、link-local、私网和 metadata 地址；连接前后防 DNS rebinding。
- Ollama 本地访问是显式例外，不与云 Provider Secret 共用。
- 重定向默认关闭；若启用，只允许同源且每跳重新校验，跨源绝不携带认证 Header。
- 每个 Provider 请求只读取该配置绑定的 Secret，不允许 Adapter 枚举 SecretStore。
- 设置连接、响应头、总时长、正文空闲和最大响应大小限制；JSON 按分块原始字节累计后再缓冲，SSE 的注释和协议框架同样计入总量。
- TLS 证书错误默认失败，不提供全局“忽略证书”开关。
- 网络错误响应先限长、按内容类型解析并脱敏，再映射为 `AppError`。
- Provider 请求只携带用户当前批准的上下文；UI 清楚显示数据将发送到哪个端点。

自定义端点天然存在数据外传风险。首次使用或 Host 改变时必须展示端点、协议和将发送的上下文
范围；不能因为用户输入 API Key 就默认信任 URL。

## 10. 数据库、Artifact 与隐私

- SQLite 和 Artifact 存放于平台 `userData`，限制为当前用户访问。
- API Key、敏感 Header、命令环境中的 Secret 永不以明文写入数据库；当前 `secure_secrets`
  只保存由操作系统安全能力加密后的密文。
- 数据库中的对话、Diff 和终端输出仍属敏感数据；UI 提供保留、导出和永久清除说明。
- MVP 不声称数据库内容已加密；磁盘加密和操作系统账户安全仍重要。
- 后续若引入 SQLCipher，密钥必须来自系统凭据库且纳入迁移与恢复测试。
- Artifact 使用随机/哈希名称，不使用未经清理的工作区相对路径。
- 数据库参数化查询；Drizzle Schema 与迁移受版本控制，启动时校验迁移 checksum。
- 备份/导出默认不含凭据，并提醒导出内容可能包含源码与终端输出。

阶段 5 已将会话、消息、Agent 任务和工具调用记录持久化到 SQLite。工具输入与有界结果用于任务
恢复和审计展示，可能包含工作区源代码片段，因此这些表不宣称应用层加密；API Key 与敏感 Header
仍只以操作系统安全能力保护的密文存在于 `secure_secrets`。Markdown 导出必须由用户显式发起并
通过系统保存对话框选择目标。异常退出时未完成任务不会自动重放模型或工具副作用，而是标记为可重试
失败。阶段 6 的模型写工具只创建私有提案 Artifact；只有用户批准后，主进程才会执行文件事务。
若应用或回滚时退出，启动恢复按基线/拟议哈希识别磁盘状态并恢复基线；任何未知内容都会停止恢复，
标记为需要人工处理，绝不覆盖用户的新修改。Artifact 包含源码明文，因此依赖操作系统账户隔离和
磁盘加密；它不包含 Provider Secret。

## 11. 日志、审计与错误

### 11.1 日志分类

- `debug`：开发诊断，生产默认关闭。
- `info`：应用生命周期和非敏感状态。
- `warn`：可恢复异常、策略拒绝和兼容性问题。
- `error`：失败与 cause ID，不直接序列化原始异常对象。
- `audit`：密钥增删、文件删除/应用/回滚、命令执行、越界访问和权限决定。

### 11.2 脱敏

日志管道在格式化前递归脱敏：

- Header：Authorization、Cookie、API Key、Token、Secret 等。
- URL：移除 userinfo 和敏感 Query 参数。
- 已知 Secret：全值和足够长的片段替换为 `[REDACTED]`。
- Provider 错误：限长后再输出，避免服务端回显请求内容。
- 文件和消息：默认只记录 ID、路径哈希、大小和耗时，不记录正文。

审计日志记录“谁、何时、对哪个规范化目标、做了什么、结果如何”，不记录完整命令环境、密钥或
完整文件内容。

## 12. 依赖、构建与发布

- pnpm lockfile 固定依赖；CI 使用 frozen lockfile。
- 原生依赖在 Electron ABI 下分别对 Windows/macOS 重建并测试。
- `pnpm security:dependency-audit` 对完整 workspace 依赖图（包括桌面运行时位于 `devDependencies` 的依赖和打包工具链）执行 high/critical 阻断审计并输出 JSON；已知易受攻击的传递版本由带版本范围的 pnpm override 精确固定到修复版。`pnpm security:licenses` 对 SBOM 中全部随包第三方组件执行许可证清单门禁；`pnpm security:secrets` 扫描 Git 跟踪及未忽略首方文本，白名单必须绑定文件、规则、脱敏指纹和原因。未知许可证、新增凭据或失效白名单都会阻断发布。
- 生产包禁止包含 `.env`、测试凭据、源码地图中的 Secret 或开发服务器地址。
- Windows 和 macOS 产物签名；macOS 完成 notarization 后发布。
- 正式 Tag 发布工作流强制要求受保护 `release-signing` Environment 中的 Windows/macOS 签名 Secret；Windows 在安装烟测前验证 Authenticode，macOS 在上传前验证 `codesign`、Gatekeeper 与 stapled notarization ticket。凭据只从受保护 CI Secret 注入，缺失时发布失败而不是回退到未签名产物；仓库写权限仅授予最终发布 Job。
- 签名打包还依赖独立 Windows runner 的 240 分钟 Electron 稳定性 Job；普通质量门禁或短时冒烟不能替代该发布阻断条件。
- 自动更新若实现，必须验证签名并使用 HTTPS；MVP 可暂不自动更新。
- 构建产物生成 SHA-256 和通过 CycloneDX 1.6 Schema 验证的 SBOM；SBOM 区分随包组件与开发/构建组件，并显式包含 Electron、node-pty、js-debug、debugpy、JDT LS 和 Java Debug Server。发布流程最小化令牌权限。
- 打包后的 js-debug/debugpy/JDT LS/Java Debug Server 资源必须与固定来源和 SHA-256 一致；不得从工作区或网络动态加载任意 Adapter。

## 13. 安全测试门槛

### 单元测试

- 路径规范化、大小写、盘符、UNC、`..`、软链接/junction 和新文件父目录。
- 敏感文件规则、工作区外访问和规则优先级。
- Header/API Key/URL/Provider 错误脱敏。
- IPC Schema 拒绝未知字段、超长输入和畸形 union。
- Permission input digest、过期、重放、变更后失效。
- FileChange 状态流转、基线冲突和回滚保护。
- 命令分类、参数显示、shellMode 拒绝和白名单作用域。
- DAP reference、调试控制状态、断点状态和适配器注册表重复/未知类型拒绝。
- 调试输出、异常、变量和表达式结果中的已知 Secret 脱敏。
- 调试上下文通用凭据键、URL、敏感变量名、截断、快照摘要、过期与跨会话绑定。
- 高级断点字段长度、未知字段、异常策略枚举、旧数据库迁移和工作区绑定。

### 集成与 E2E

- 系统凭据库写入、存在检查、更新、删除和失败补偿；不在日志/SQLite 出现 Secret。
- 文件多变更应用中途失败后恢复原状。
- Windows 文件锁、macOS 权限拒绝和崩溃恢复。
- 恶意仓库 Prompt 尝试读取 `.env`/SSH key 时被阻止并产生审计记录。
- Renderer 尝试调用未暴露 IPC 或伪造审批时失败。
- Provider 重定向、HTTP、私网目标、超大响应和取消。
- 命令审批内容与实际 spawn 参数逐项一致。
- 真实 Node 调试覆盖审批、命中断点、线程/调用栈/局部变量、单步、求值、停止和重启恢复。
- 真实 Node 调试覆盖条件、命中次数、日志断点，以及 all/none 异常暂停行为和重启持久化。
- 真实 Node Inspector 附加覆盖不可变端点审批、断点、栈、变量，以及断开后外部目标仍然存活。
- 调试器异常退出、正常停止和应用关闭后，不残留由应用拥有的 adapter/debuggee 进程。
- 真实异常经过脱敏预览后进入 AI，Provider 请求不含运行时 Secret；AI 修复在批准前不改变磁盘，
  重新调试只能由用户显式触发。

任何关键安全测试失败时，相关阶段不能标记为完成。

## 14. 已知剩余风险与接受条件

| 风险                        | MVP 处理                         | 接受条件                                          |
| --------------------------- | -------------------------------- | ------------------------------------------------- |
| 本地对话数据库未应用层加密  | 依赖 OS 账户/磁盘保护，清楚披露  | 不含 API Key；提供清除；文档不宣称加密            |
| Prompt injection            | 工具权限与数据策略独立于模型     | 模型文本不能提升权限，敏感访问始终阻断/审批       |
| OpenAI 兼容差异             | 防御性 SSE Parser 与契约测试     | 不兼容时明确报错，不误执行残缺工具参数            |
| 多文件非真正 ACID           | Saga、快照、哈希与恢复扫描       | 故障注入测试证明可恢复或明确标记人工处理          |
| 包管理脚本可执行任意代码    | 每次显示并审批，受 cwd/超时约束  | 不自动信任 `test` 名称，不携带 Provider Secret    |
| 第三方原生模块供应链        | 锁版本、扫描、签名构建           | 发布 CI 可复现安装并通过安全扫描                  |
| Debug Adapter 供应链        | 固定官方产物、来源、许可证与哈希 | 打包资源校验一致；禁止动态加载未知 Adapter        |
| 调试变量包含业务秘密        | 主进程脱敏、限长且不持久化变量树 | 用户逐分区预览确认；E2E 证明 Secret 不到 Provider |
| 调试上下文 Prompt injection | 上下文标记为不可信数据           | 不提升工具权限；写入、命令和重启仍需独立用户动作  |

## 15. 安全评审检查点

每个阶段进入下一阶段前检查：

- 新 IPC 是否最小化、双向 Schema 校验且有权限边界。
- 新存储字段是否可能包含密钥、源码或个人信息。
- 新 Tool 是否有资源限制、路径/网络/命令策略和审计事件。
- 新 Provider 是否隔离 Secret、限制重定向并完成错误脱敏。
- 新 UI 是否可能渲染原始 HTML、完整 Secret 或未转义终端内容。
- 新副作用是否可取消、可恢复，并在执行前绑定审批摘要。
