# 更新日志

本文档记录 OpenCode Desk 各阶段版本的用户可见变化。版本遵循语义化版本规范；正式版发布前使用预发布标识。

## [0.7.0-alpha.1] - 2026-08-02

### 新增

- 增加完整 ProjectTask 系统，支持九类任务、依赖拓扑、启动/调试前后钩子、审批、停止、重试、脱敏输出和历史恢复。
- 增加组合运行配置，可一次批准并发启动多个服务、独立查看输出/状态、单独停止或一键停止全部，并按策略在单服务失败时联动清理。
- 增加服务端口与进程管理：端口占用检测、PID/进程名展示、重复服务阻止，以及确认后带 PID 复核的安全终止。
- 增加函数、数据断点定义与 DAP 能力协商；不支持时保持未验证状态，不发送伪请求或声称成功。
- 增加指定异常类型暂停和异常忽略列表：Node.js 使用受转义的 `error.name` 条件；Python 通过 DAP `exceptionOptions` 设置正向规则，并以 `exceptionInfo` 精确识别忽略类型后自动继续。
- 文件树、聊天栏和底部运行/调试面板均可拖动、键盘调整、双击复位并跨重启恢复尺寸。
- 自动发现工作区 `.venv/venv/env`、当前激活环境和 PATH 中的 Python 解释器，工作区虚拟环境优先。
- Python 运行配置界面显示解释器来源和 `pyvenv.cfg` 版本线索，并保留手动路径覆盖能力。
- 从入口与有界依赖元数据生成普通脚本、Django、Flask、FastAPI/uvicorn 和 pytest 建议配置。
- 增加独立 `debugpy` Provider，真实支持 Python 断点、调用栈、变量、求值、单步、异常与控制台输出。
- 随安装包固定分发官方 `debugpy 1.8.21`，用户无需向项目虚拟环境安装调试依赖。
- 核心工作台、设置、运行、调试、任务、Git、终端、审计和审批界面支持简体中文/英文切换，并随设置同步文档语言标记。

### IDE 使用痛点改进

- 优先使用项目虚拟环境，减少“终端能运行、IDE 却选了另一个 Python”的环境漂移。
- 未发现解释器时明确显示“尚未验证”，启动失败提示解释器版本和下一步，不伪装为可用。
- 打开项目只做有界文件探测，不执行项目内 Python；建议配置必须由用户保存并批准后才能运行或调试。
- 调试器由应用提供，避免为了打断点污染 requirements/pyproject 或要求每个项目重复安装 debugpy。

### 安全与可靠性

- 主进程持续持有唯一 `BrowserWindow`，并在窗口关闭后才释放引用，修复长时间运行中窗口被垃圾回收、应用随后正常退出的问题；E2E 可主动触发主进程 GC 验证窗口仍存在。
- 命令允许规则改为精确绑定可执行文件、工作目录和全部参数；旧的宽泛允许规则自动失败关闭，同一程序的不同参数必须重新批准。
- Provider JSON/SSE 正文改为增量字节限额，并增加响应体停滞超时与总体时长限制；分块响应、SSE 注释、框架数据及持续小块输送均无法绕过资源边界。
- 工作区磁盘访问只接受当前显式打开的工作区，历史最近工作区 ID 不再自动恢复文件、Git、终端、命令或运行授权。
- 增加受保护 `release-signing` Environment 驱动的正式 Tag 发布工作流，强制 Windows Authenticode、macOS 签名/notarization/Gatekeeper 验证，并只向最终发布 Job 授予仓库写权限。
- Windows 安装烟测在应用无法正常退出或卸载后仍留下可执行文件时直接失败，不再用强制结束进程掩盖验收失败。
- debugpy 固定版本、官方来源、MIT 许可证和 wheel SHA-256，并作为 electron-builder 只读资源打包。
- 适配器只监听 `127.0.0.1` 随机端口，进程使用参数数组与 `shell: false`，停止/退出清理拥有的进程树。
- Python 输出、变量、表达式与异常复用 DAP Secret 脱敏和工作区路径投影，不把外部源码路径交给 Renderer。
- CI 分支门禁覆盖 `develop`、`release/**` 和 `main`，阶段分支通过后再合并基线。
- Windows/macOS/Linux 打包在 electron-builder 前校验全部 15 个桌面生产依赖，缺失链接时立即失败，避免生成入口依赖不完整的 ASAR。
- SQLite migration 12–16 持久化 ProjectTask、端口、组合运行、函数/数据断点和高级异常规则；旧数据库自动升级。
- 文本上下文改为顶层对话框，聊天页脚在底部面板打开时保持容器内滚动，不再被运行/终端区域遮挡。

### 验证

- 主窗口强引用回归、20 会话/模型切换/重启快速验收和 5 分钟主动 GC 强化耐久测试通过；正式 4 小时验收仍以最终退出码为准。
- Vitest：103 个测试文件、349 个测试通过；5 个真实环境门禁文件中的 7 项默认跳过（标准脚本限制为 4 个 worker，避免真实调试器并行争用）。
- 真实 debugpy 集成验证断点、局部变量、求值、单步、全部异常、敏感输出脱敏和终止清理。
- Playwright Electron 定向场景完成“解释器发现 → 配置 → Monaco 断点 → 变量 → 单步 → 停止”。
- Playwright Electron 全量 16 个场景通过，新增覆盖 ProjectTask、组合运行、三向布局、端口检测、高级断点恢复，以及会话重新生成、搜索、导出、删除和重启持久化。
- Windows x64 NSIS 在独立临时目录完成静默安装、9/9 已安装应用核心 E2E、6/6 桌面壳/持久化 E2E、1.61 秒冷启动、正常关闭、零残留进程和静默卸载。
- 当前工作树快照在 Debian 12 Linux x64 容器完成原生 `node-pty` 编译、AppImage 打包/自解包、运行时完整性校验、GNOME Secret Service 写入/读取/清除及已打包应用核心 E2E 9/9；本地 AppImage SHA-256 为 `31D2C23A18AC8168B6D9BCAE9E62D0652C6BF9CF39D05D5A1C110D964BCEB45E`。

### 已知限制

- Python 调试当前支持 Python 3.8+ 的脚本和 `-m` 模块启动；暂不支持 `-c` 内联代码、attach 和远程调试。
- Poetry/Conda 的工作区外环境管理器枚举尚未接入，只识别当前激活环境、常见工作区 venv 和 PATH。
- Java、浏览器、C/C++/Rust、Go 与 .NET Debug Adapter 均已接入；Windows 已分别完成真实 Chrome、Maven/JDT LS、LLVM/LLDB、Delve 和 NetCoreDbg 原生调试验收。JDT LS 现在按平台与 CPU 架构选择 Intel/ARM64 配置，公共 CI 的 macOS 目标固定为 `macos-15` ARM64，macOS/Linux 打包作业会以 JDK 21 运行真实 Java 调试验收；当前工作树仍待提交并取得这两项公共原生 runner 结果。
- 内置 js-debug 不声明函数/数据断点能力，debugpy 不声明数据断点能力；应用会明确显示未验证，等待具备对应能力的 Adapter。
- Windows 代码签名、macOS 签名/notarization 和干净设备安装验收仍是正式发布门槛。

## [0.6.0-alpha.1] - 2026-08-02

### 新增

- Monaco 断点编辑器支持条件表达式、命中次数和日志消息，gutter 与断点列表按类型显示不同标识。
- Node.js/TypeScript Adapter 将条件、命中规则与日志消息映射到真实 DAP `setBreakpoints` 请求。
- 增加“不因异常暂停 / 仅未捕获异常 / 全部异常”工作区策略，并支持调试过程中实时切换。
- 高级断点和异常策略通过 SQLite migration 11 持久化，应用重启后恢复。

### IDE 使用痛点改进

- 可直接在特定数据状态暂停，不再为了定位某次循环或某个请求反复修改业务代码。
- 日志断点可以输出插值后的运行时值而不中断程序，减少临时日志污染和清理成本。
- 断点状态、条件摘要和 Adapter 错误保持可见，避免“图标存在但实际没有绑定”的隐性失败。

### 安全与可靠性

- 高级断点表达式只通过已批准调试会话发送给 DAP，不作为系统命令、Shell 或 Agent 工具执行。
- IPC 使用严格 Zod 长度与字段校验；断点和异常策略只能绑定当前工作区。
- 会话生命周期与工作区调试配置拆分，调试服务和 Renderer Store 均保持在 400 行以内。
- migration 11 可从旧版 user_version 10 无损升级，已有普通断点保持有效。

### 验证

- Vitest：68 个测试文件、212 个测试通过。
- Playwright Electron E2E：12 个场景通过。
- 真实 js-debug 集成验证条件断点、命中次数、日志断点、全部异常和不因异常暂停。

### 已知限制

- 完整调试闭环仍只覆盖 Node.js/TypeScript；其他语言 Adapter 尚未接入。
- 函数断点、数据断点、特定异常类型和异常忽略列表尚未实现。
- Windows 代码签名、macOS 签名/notarization 和干净设备安装验收仍是正式发布门槛。

## [0.5.0-alpha.1] - 2026-08-02

### 新增

- 调试暂停或异常时增加“交给 AI 分析”入口，先在主进程收集并脱敏调试上下文，再由用户逐分区预览和确认。
- 调试快照可包含暂停位置、源码片段、异常、调用栈、局部变量、监视、控制台、运行配置、Git Diff、最近变更和依赖。
- 确认后的快照作为高优先级诊断上下文进入当前会话，复用现有 Agent 只读工具与 FileChange Diff 审批链路生成修复。
- 完成真实“未捕获异常 → 脱敏预览 → AI 读取源码 → 修复 Diff → 用户批准 → 重新调试成功”Electron E2E。

### 安全与可靠性

- 快照仅在内存保留已脱敏版本，10 分钟过期；摘要、会话、工作区和暂停位置任一变化都会拒绝附加。
- 增强通用密码、Token、API Key、数据库 URL 与凭据 URL 脱敏；敏感变量名即使值不符合已知密钥形状也会隐藏。
- SQLite 只保存用户最终选择的已脱敏诊断上下文，不保存完整变量树、原始异常或未选择分区。
- AI 不得绕开现有 Diff 审批、命令审批或调试控制；应用修复后仍需用户显式点击重新调试。
- 修复 js-debug 在未捕获异常暂停时原生 restart 可能卡住的问题，改为清理旧适配器后按同一已批准配置重建 DAP 会话。

### 验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 Electron E2E 均纳入阶段门禁。
- 新增调试上下文 IPC、脱敏、SQLite 附加、真实 DAP 重启和 AI 修复闭环测试。

### 已知限制

- 完整调试和 AI 修复闭环当前只覆盖 Node.js/TypeScript；其他语言 Adapter 尚未接入。
- 暂不支持跨多个调试会话或微服务自动关联上下文，也不会自动判定业务级修复正确性。
- Windows 代码签名、macOS 签名/notarization 和干净设备安装验收仍是正式发布门槛。

## [0.4.0-alpha.1] - 2026-08-02

### 新增

- 增加 DAP framing/client、可扩展 Debug Adapter Registry 和独立 Node.js Debug Adapter。
- 支持真实普通行断点、验证状态、线程、调用栈、作用域、局部/嵌套变量和持久化监视表达式。
- 支持继续、暂停、Step Over、Step Into、Step Out、运行到光标、重启和停止调试。
- 增加独立调试控制台、表达式求值、异常信息、当前执行行高亮和源码自动定位。
- SQLite migration 10 新增调试会话、断点和监视数据，应用重启后可恢复调试历史。

### 安全与可靠性

- 调试开始前展示结构化命令快照和风险，审批摘要变化后拒绝重放旧批准。
- 调试输出、变量、表达式结果和异常信息在进入 UI/数据库前按真实 Secret 值脱敏。
- 固定官方 `vscode-js-debug 1.117.0`，记录来源、许可证与入口 SHA-256，并随桌面包分发。
- 停止、协议终止、适配器异常和应用退出均清理本应用拥有的 adapter/debuggee 进程。
- 修复 DAP 合法 `threadId = 0` 被 IPC 校验拒绝，以及断点事件/响应竞态导致重复显示的问题。
- 修复运行/调试底部面板挤压 Monaco 布局，以及文件事务 E2E 在原子替换瞬间的错误失败。

### 验证

- 格式检查、ESLint、TypeScript 严格类型检查、生产构建和 Vitest 全部通过。
- Vitest：64 个测试文件、200 个测试通过。
- Playwright Electron E2E：10 个场景通过，包含真实 Node 断点、变量、单步、求值与重启恢复。

### 已知限制

- 完整调试闭环当前只覆盖 Node.js/TypeScript；其他语言 Adapter 尚未接入。
- 条件/日志/函数断点和调试面板拖动调整尚未实现。
- 调试上下文交给 AI、生成修复 Diff 并重新验证属于下一阶段。
- Windows 代码签名、macOS 签名/notarization 和干净设备安装验收仍是正式发布门槛。

## [0.3.0-alpha.1] - 2026-08-01

### 新增

- 增加独立的受管项目运行服务、运行配置编辑器、顶部运行工具栏和运行输出面板。
- 每次运行先生成不可变命令快照和风险说明，经用户批准后才使用结构化 executable/args 启动。
- 支持项目启动、实时 stdout/stderr、停止、重新运行、PID、退出码、错误和历史恢复。
- 增加 `run_executions` SQLite migration 9，持久化审批摘要、状态、输出尾部和退出结果。
- 支持普通与敏感运行环境变量；敏感值只通过系统安全凭据存储引用进入运行时。

### 安全与可靠性

- 运行进程使用 `shell: false`，校验工作区边界、环境文件摘要和配置版本，阻断提权与高风险模式。
- 输出流在显示和落库前执行 Secret 脱敏与字节上限，应用退出时清理仍在运行的子进程树。
- Linux CI 使用真实 GNOME Secret Service，并验证 Electron 实际选择 `gnome_libsecret`，不接受 Playwright 的 `basic_text` 测试后端。

### 验证

- 格式检查、ESLint、TypeScript 严格类型检查、生产构建和 Vitest 全部通过。
- Vitest：54 个测试文件、181 个测试通过。
- Playwright Electron E2E：9 个场景通过。
- GitHub Actions 已通过 Windows x64、macOS 和 Linux x64 安装包构建。

### 已知限制

- 本版本完成项目运行闭环，不包含 DAP client、真实断点、调用栈、变量、监视或单步调试。
- Windows 代码签名、macOS 签名/notarization 和干净设备安装验收仍是正式发布门槛。

## [0.2.0-alpha.1] - 2026-08-01

### 新增

- 增加 16 类项目类型的有界自动识别，包括 Node.js、TypeScript、React、Vue、Next.js、Java、Spring Boot、Python、C/C++、.NET、Go 和 Rust。
- 根据 `package.json` scripts、项目标志文件和常见入口生成安全的运行配置建议。
- 增加运行配置领域模型、严格 Zod IPC 契约和 renderer 最小 API。
- 增加 `run_configurations` 与 `workspace_run_settings` SQLite 迁移、CRUD 和默认配置持久化。
- 敏感运行环境变量使用系统安全存储引用，公开 DTO 与 SQLite 配置记录不返回或保存明文。
- 补充完整 README，包括开发、测试、打包、模型配置、安全说明和当前限制。

### 修复

- 修复 Linux CI 无法正确归一化 Windows executable 路径的问题。
- 调整原生 PTY 和文件事务集成测试的统一超时预算，避免全套并发测试中的错误超时。

### 验证

- 格式检查、ESLint、TypeScript 类型检查和生产构建通过。
- Vitest：50 个测试文件、162 个测试通过。
- Playwright Electron E2E：8 个场景通过。

### 已知限制

- 本版本只完成项目识别与运行配置基础，尚不能从运行配置启动或停止进程。
- DAP、真实断点、调用栈、变量、单步调试和 AI 调试上下文尚未实现。
- 正式 Windows/macOS 安装包仍需要代码签名、notarization 和干净设备验收。

[0.2.0-alpha.1]: docs/releases/0.2.0-alpha.1.md
[0.3.0-alpha.1]: docs/releases/0.3.0-alpha.1.md
[0.4.0-alpha.1]: docs/releases/0.4.0-alpha.1.md
[0.5.0-alpha.1]: docs/releases/0.5.0-alpha.1.md
[0.6.0-alpha.1]: docs/releases/0.6.0-alpha.1.md
[0.7.0-alpha.1]: docs/releases/0.7.0-alpha.1.md
