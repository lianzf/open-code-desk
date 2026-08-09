# OpenCode Desk

OpenCode Desk 是一款本地优先、审批驱动的跨平台 AI 编程桌面工具。它使用 Electron、React 和 TypeScript 构建，允许用户自行配置模型服务地址、API Key 与模型名称，并通过统一 Provider 和 Tool 契约扩展新的模型或编程工具。

当前阶段版本：[`0.7.0-alpha.1`](docs/releases/0.7.0-alpha.1.md)

当前交付分类：**内部 Alpha**。该版本仅用于受控内部测试，不作为正式发布；未创建
`v0.7.0-alpha.1` Tag 或 GitHub Release。

模型输出始终被视为不可信输入。文件写入必须先生成 Diff 并由用户审核，命令执行必须经过风险评估和明确授权，渲染进程不能直接访问文件系统、数据库、密钥或系统 Shell。

## 当前能力

- 打开和恢复本地项目，增量浏览文件树，按文件名或代码内容搜索
- 使用 Monaco Editor 多标签查看、编辑和保存代码，检测外部修改冲突
- 配置 OpenAI、Anthropic、Gemini、OpenRouter、DeepSeek、通义千问、智谱 GLM、Moonshot/Kimi、Ollama 和 OpenAI API 兼容服务
- 使用操作系统安全存储保护 API Key 和敏感请求头
- 进行多轮流式对话，停止生成、重新生成、复制消息和导出 Markdown
- 通过受控工具读取、搜索和分析项目，不自动发送整个项目
- 生成文件修改提案，在 Monaco Diff Editor 中逐项或批量审核、应用和回滚
- 审批并执行结构化终端命令，显示实时输出、退出码、超时和取消状态
- 识别项目类型并管理运行配置，经逐次审批后启动、停止和重新运行项目，持久化运行输出与历史
- 创建构建、清理、测试、启动、打包、部署、Lint、类型检查和自定义 ProjectTask，支持依赖、运行/调试前后钩子、停止、重试、输出与历史恢复
- 使用组合运行配置并发启动多个服务，独立查看输出和状态、分别停止或一键停止；显示端口、检测占用进程，并只在明确确认和 PID 复核后终止占用者
- 使用真实 Node.js、Python、浏览器与 Electron 双进程 Debug Adapter 设置普通、条件、命中次数和日志断点，查看线程、调用栈、局部变量和监视表达式
- 创建函数与数据断点，并按 Adapter 能力发送真实 DAP 请求；不支持的 Adapter 会明确保留为“未验证”，不会伪报成功
- 自动发现 Python 工作区虚拟环境、当前激活环境和 PATH 解释器，并生成 Django、Flask、FastAPI 与 pytest 建议配置
- 使用随应用固定分发的 debugpy 调试用户所选 Python 3.8+ 解释器，无需向项目环境安装调试依赖
- 通过现有 `debugpy.listen()` 端点附加远程或容器内 Python 进程，支持源码映射，并在断开时保留目标进程
- 按工作区配置“不暂停 / 仅未捕获 / 全部异常”、指定异常类型暂停和异常忽略列表，调试中修改后立即同步到 Adapter
- 在 Monaco 中高亮当前执行行，并继续、暂停、单步、运行到光标、重启或停止调试会话
- 使用独立调试控制台查看脱敏输出、异常信息并执行表达式求值
- 暂停或异常时预览已脱敏的源码、调用栈、变量、输出、Git Diff 与依赖，明确选择后交给 AI 分析
- AI 可继续读取相关文件并生成待审核修复 Diff；应用后只能由用户显式重新调试验证
- 查看 Git 分支、工作区状态和 Diff
- 持久化工作区、模型配置、会话、Agent 任务、工具调用、文件变更、命令记录、权限规则和审计日志
- 拖动或用键盘调整文件树、聊天栏与底部运行/调试面板，重启后恢复工作台布局
- 支持主题、界面语言、快捷键、崩溃记录和受控自动更新

IDE 级项目识别、运行配置、受管进程、Node.js/TypeScript、Python、浏览器与 Electron 主/渲染进程 DAP 调试和 AI 辅助修复已经
形成真实闭环。调试状态来自官方 js-debug/debugpy 的协议事件，不从普通运行日志推断。调试上下文只在用户点击“交给 AI
分析”、审核脱敏预览并确认后进入当前会话；模型产生的修复仍必须经过原有 FileChange Diff 审批，
系统不会自动修改变量、执行命令或重启调试。

## 技术栈

- Electron + electron-vite
- React + TypeScript + Vite
- Tailwind CSS + Radix UI
- Zustand
- SQLite + Drizzle ORM
- Monaco Editor / Monaco Diff Editor
- xterm.js + node-pty
- simple-git
- Zod
- Vitest + Playwright
- electron-builder

## 开发环境

- Node.js `22.12.0` 至 `25.x`
- pnpm `10.29.2`
- Windows、macOS 或 Linux 桌面环境
- 构建本机安装包所需的平台工具链

仓库使用 pnpm workspace。首次安装依赖：

```bash
corepack enable
corepack prepare pnpm@10.29.2 --activate
pnpm install --frozen-lockfile
```

## 本地运行

```bash
pnpm dev
```

开发模式会启动 Electron 主进程、preload 和 React renderer。API Key 只能通过应用内模型设置录入，不需要也不应写入仓库环境文件。

## 质量检查

```bash
pnpm format:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm security:secrets
pnpm security:dependency-audit
pnpm security:licenses
pnpm build
pnpm test:e2e
```

`pnpm test` 包含单元与集成测试；`pnpm test:integration` 可单独复验真实文件系统、进程、PTY、Git、DAP 和持久化集成场景。`pnpm test:e2e` 会先构建桌面端，再运行 Playwright Electron 场景。普通模型协议测试使用本地 HTTP/SSE 测试服务，不要求开发者提供真实厂商密钥。发布前如需验证真实服务，可按[模型配置指南](docs/model-configuration.md#真实服务验收发布前可选门禁)临时提供所选 Provider 的 Base URL、Model ID 和凭据，再运行 `pnpm test:providers:live`；未设置选择器时该专用命令会失败，而普通测试会明确跳过真实网络门禁。

## 构建安装包

```bash
pnpm package:win
pnpm package:mac
pnpm package:linux
```

产物写入 `release/`：

- Windows：NSIS x64 安装程序
- macOS：DMG 与 ZIP
- Linux：AppImage

打包命令会在生成产物后校验目标平台可执行文件、调试适配器和 `node-pty` 原生模块；任一运行时依赖缺失都会使打包失败。它还会生成 CycloneDX SBOM、完整工作区依赖审计、随包第三方许可证审计、Secret 扫描报告和覆盖这些元数据的 SHA-256 清单。CI 会直接启动解包后的应用运行 9 项核心端到端场景。

跨平台正式发布应在对应原生 CI runner 上构建。公开发布前还必须配置 Windows 代码签名、macOS 签名与 notarization，并由独立人员按[干净设备验收清单](docs/clean-device-acceptance.md)完成安装、核心 AI 编程闭环、IDE 调试修复闭环、卸载和更新验证。

### 正式签名发布

向远端推送与根 `package.json` 版本一致的 `v*` Tag 会触发
[`Signed release`](.github/workflows/release.yml) 工作流。该工作流会重新执行完整质量门禁，并且：

- Windows 构建要求 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`，缺失或 Authenticode 验证失败时停止发布；签名安装包安装后还会执行 Provider/Agent、Diff、命令/Git、运行、Node/Python 调试、AI 修复、ProjectTask 和组合运行 E2E，再验证正常关闭与卸载。
- macOS 构建要求 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`，并强制检查签名、Gatekeeper 和 stapled notarization ticket。
- Linux 构建会验证 AppImage 可解包且包含可执行的 `AppRun`。
- 正式 Tag 必须先通过独立 Windows runner 上的 240 分钟 Electron 稳定性验收；质量门禁与耐久验收都通过后才启动三平台打包。
- 三个平台全部成功后才创建或更新 GitHub Release，并生成合并后的 SHA-256 清单。

证书、私钥和密码只能配置在受保护的 `release-signing` GitHub Environment 中，不能提交到源码、普通配置文件或构建日志。该 Environment 应设置必要的人工审批者；普通分支 CI 仍生成不签名的测试产物，只有上述 Tag 工作流可以形成正式发布候选。工作流默认只有仓库读取权限，写入 Release 的权限仅授予全部平台通过后的最终发布 Job。

## 配置模型

1. 启动应用并打开一个项目目录。
2. 进入“模型设置”。
3. 选择预置 Provider，或选择 OpenAI Compatible 添加自定义服务。
4. 填写显示名称、Base URL、API Key 和默认 Model ID。
5. 按需配置快速模型、高级推理模型、上下文长度、工具调用、图片、流式响应和自定义 Header。
6. 点击“测试连接”，确认服务返回明确的成功结果。
7. 拉取或手动填写模型列表，在工作台选择当前模型。

OpenAI Compatible 服务的远程地址必须使用 HTTPS；本机 Ollama 等服务可以使用明确允许的本地 HTTP 地址。应用拒绝 URL 内嵌凭据、危险重定向和不安全的传输 Header。

## 安全设计

- `contextIsolation` 开启，`nodeIntegration` 关闭，renderer sandbox 开启
- preload 仅暴露类型化最小 API；IPC 请求和响应均使用 Zod 校验
- API Key 与敏感 Header 由 Electron `safeStorage` 保护，SQLite 仅保存密文或引用信息
- Linux 上若安全存储退化为 `basic_text`，应用拒绝保存密钥
- 文件路径经过规范化、真实路径和工作区边界检查
- `.env`、SSH 私钥、浏览器凭据等敏感文件默认拒绝读取
- AI 文件修改只有在 Diff 审核后才会写入
- 命令使用结构化 executable/args 且 `shell: false`，高风险模式会拒绝或单独确认；“记住允许”精确绑定完整参数，不会放行同一程序的其他载荷
- 日志、审计、崩溃报告和公开错误会脱敏

完整威胁边界与控制措施见 [安全设计](docs/security.md)。

## 项目结构

```text
apps/desktop/                 Electron 主进程、preload 与 renderer
packages/domain/              纯 TypeScript 领域类型
packages/application/         Agent 状态机与上下文构建
packages/provider-core/       Provider 契约与注册表
packages/tool-core/           Tool 契约、注册表与调度器
packages/ipc-contracts/       IPC Channel、Zod Schema 与 DesktopApi
tests/e2e/                    Electron 端到端场景
docs/                         架构、安全与路线图
```

详细分层、数据流和扩展原则见 [系统架构](docs/architecture.md)。

## 常见问题

### 为什么模型连接测试失败？

确认 Base URL 是否包含正确的 API 版本路径、Model ID 是否存在、API Key 是否有权限，以及服务是否支持所选能力。界面会区分认证失败、模型不存在、限流、超时、上下文过长和服务不可用。

### 为什么某个文件无法读取？

应用默认限制在当前工作区内，并阻止敏感文件、软链接逃逸和路径穿越。工作区外目录只能通过系统目录选择器显式授权，且仍需逐次批准。

### 为什么命令没有立即执行？

Agent 提议的命令必须先展示可执行文件、参数、目录和风险原因。普通命令默认需要确认，提权、广泛删除、编码 PowerShell、下载后立即执行等模式会被阻止。

### 安装包是否已完成正式签名？

没有。当前内部 Alpha 使用未签名 CI 测试产物；正式发布仍需要发布者提供平台签名证书并完成
notarization、真实 Provider 与独立干净机器验收。未签名构建仅用于开发和受控内部测试。

### 可以添加新的模型服务商吗？

可以。实现独立 Provider Adapter、配置 Schema、注册表注册、配置表单和契约测试即可；Agent、文件变更和权限主流程不应出现新的厂商分支。

## 文档

- [安装与首次启动](docs/installation.md)
- [干净设备独立验收清单](docs/clean-device-acceptance.md)
- [使用指南](docs/user-guide.md)
- [故障排查指南](docs/troubleshooting.md)
- [隐私与本地数据说明](docs/privacy.md)
- [模型配置指南](docs/model-configuration.md)
- [Provider 开发指南](docs/provider-development.md)
- [Tool 开发指南](docs/tool-development.md)
- [更新日志](CHANGELOG.md)
- [0.7.0-alpha.1 阶段版本说明](docs/releases/0.7.0-alpha.1.md)
- [0.6.0-alpha.1 阶段版本说明](docs/releases/0.6.0-alpha.1.md)
- [0.5.0-alpha.1 阶段版本说明](docs/releases/0.5.0-alpha.1.md)
- [0.4.0-alpha.1 阶段版本说明](docs/releases/0.4.0-alpha.1.md)
- [0.3.0-alpha.1 阶段版本说明](docs/releases/0.3.0-alpha.1.md)
- [0.2.0-alpha.1 阶段版本说明](docs/releases/0.2.0-alpha.1.md)
- [系统架构](docs/architecture.md)
- [Provider 契约与扩展说明](docs/architecture.md#71-provider-契约)
- [Tool 契约与扩展说明](docs/architecture.md#72-tool权限与执行契约)
- [数据库设计](docs/architecture.md#9-数据库设计)
- [安全设计](docs/security.md)
- [开发路线图](docs/roadmap.md)
- [10,000 文件性能验收报告](docs/reports/performance-2026-08-02.md)
- [0.7.0-alpha.1 发布就绪审计](docs/reports/release-readiness-2026-08-02.md)
- [项目目标完成度审计](docs/reports/objective-completion-audit-2026-08-03.md)
- [0.7.0-alpha.1 测试报告与已知问题](docs/releases/0.7.0-alpha.1.md#验证记录)

## 当前限制

- 当前 DAP 调试闭环覆盖 Node.js/TypeScript、Python、浏览器前端、Electron 主/渲染进程、Java、C/C++/Rust、Go 和 .NET。Electron 使用同一固定 js-debug 服务的 `pwa-node` 与 `pwa-chrome` 客户端，已在 Windows 以真实 Electron 进程验证两侧源码断点、变量读取和退出清理。Java 使用固定版本 JDT LS 1.60.0 与 Microsoft Java Debug Server 0.53.2，要求本机提供 JDK 21+，并按平台与 CPU 架构选择 JDT LS 的 Intel/ARM64 配置；Windows 已分别以真实 Maven、Chrome、LLVM 22.1.8/LLDB、Go 1.26.5/Delve 1.26.3、.NET SDK 10.0.302/NetCoreDbg 3.2.0-1092 项目验证断点、栈、变量、单步、退出与进程清理。Java 还在 macOS ARM64/Linux x64 公共原生 runner 完成断点、变量、单步、异常与清理验收。外部 LLDB、Delve 与 NetCoreDbg 不随应用分发；Node.js Inspector 与 Python debugpy 已支持附加远程或容器目标，应用不自动建立 SSH/容器通道，其他语言的跨环境附加尚未完成
- 函数/数据断点会按 DAP 能力真实发送；当前 debugpy 支持函数断点，随包 js-debug 不声明函数断点能力，两个内置 Adapter 均不声明数据断点能力，因此相应条目会明确显示“未验证”
- Python 调试暂不支持 `-c` 内联代码，以及 Poetry/Conda 的工作区外环境管理器枚举
- AI 辅助调试当前一次只收集一个暂停位置；Electron 双进程可在同一调试会话中切换，但跨服务自动关联诊断尚未实现
- 正式 Windows/macOS 发布需要代码签名、notarization 和干净设备验收证据
- 10,000 文件增量加载、名称搜索与取消验收已形成[性能报告](docs/reports/performance-2026-08-02.md)，Windows 4 小时稳定性基线已通过；当前产品提交 `a3471ca` 的 Windows x64、macOS ARM64 和 Linux x64 公共原生构建、运行时校验与已打包应用 E2E 均已通过，CI run `31295938442` attempt 1 的四个 artifacts 已上传并下载复核，三平台清单 19/19 一致；该证据满足当前内部 Alpha 目标，正式发布所需的 Windows/macOS 正式签名与 notarization、全部计划 Provider 真实公网记录和独立人员干净设备验收明确延期
- 核心工作台、设置、运行、调试、任务、Git、终端、审计和审批界面已支持简体中文/英文切换；Renderer 错误展示已统一经过本地化边界，应用自有的中英文动态诊断受双向源码覆盖门禁约束，第三方工具或运行时返回的未知技术文本按原文保留

## 许可证

当前 `package.json` 标记为 `UNLICENSED`。在项目选择并提交明确的开源许可证之前，不应假定代码已获得公开再分发授权。
