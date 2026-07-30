# OpenCode Desk 开发路线图

> 状态：阶段 6 可审阅写入闭环已完成，阶段 7 待开始
> 日期：2026-07-30
> 目标：以可验证的纵向闭环交付 Windows/macOS MVP

## 1. 交付原则

1. 每阶段有明确入口条件、产物、验证命令和退出条件。
2. 测试、类型检查或构建失败时不得标记完成。
3. 先建立安全边界与最小纵向闭环，再扩大 Provider 和 Tool 数量。
4. 不用 Mock 数据冒充已实现能力；测试替身仅用于自动化测试。
5. 每阶段控制变更规模，业务文件超过 400 行前拆分。
6. 原生依赖尽早在 Windows/macOS CI 验证，避免最后集中暴露 ABI/签名问题。

## 2. MVP 模块清单

| 模块          | MVP 内容                                        | 非 MVP 预留          |
| ------------- | ----------------------------------------------- | -------------------- |
| Desktop Shell | Electron 生命周期、安全窗口、菜单、协议与打包   | 自动更新、Linux 产物 |
| Renderer      | 欢迎页、工作台、设置、历史会话、审批 UI         | 团队协作、插件市场   |
| Workspace     | 打开/最近项目、文件树、读取、搜索、保存         | SSH/远程工作区       |
| Editor        | Monaco 编辑、多标签、Diff 审核                  | 语言服务器深度集成   |
| Provider      | Registry、OpenAI Compatible、模型列表、流式聊天 | 9 个原生 Adapter     |
| Secrets       | OS Credential Manager/Keychain Adapter          | 跨设备同步           |
| Agent         | 单 Agent 状态机、工具循环、取消、重试、恢复     | 多 Agent 协作        |
| Context       | 分层来源、去重、截断、Token 预算、摘要接口      | 向量索引             |
| Tools         | 只读文件/搜索、文件变更、Git、批准命令          | MCP 完整支持         |
| Change Review | FileChangeSet、Diff、审批、原子应用、回滚       | 自动提交/PR          |
| Terminal      | 用户 PTY、AI 命令审批、输出和取消               | 远程终端             |
| Persistence   | 12+ SQLite 表、Drizzle Repository、迁移         | 云同步               |
| Observability | 可读错误、脱敏日志、审计日志                    | 远程遥测             |
| Quality       | Vitest、集成测试、Playwright、双平台构建        | 大规模性能基准       |

## 3. 阶段 1：项目分析与架构设计

### 目标

在不初始化业务工程的前提下，固定系统边界、核心契约、安全模型、数据模型和交付顺序。

### 本阶段产物

- `docs/architecture.md`
- `docs/security.md`
- `docs/roadmap.md`
- 推荐目录结构、核心 TypeScript 接口草案、数据库表设计和 MVP 验收清单

### 当前完成情况

- [x] 检查工作区与现有工程标记。
- [x] 确认 `ssh-desktop-client` 是独立 SwiftSSH 工程，不复用。
- [x] 建立四层架构、依赖方向和运行时数据流。
- [x] 定义 Provider、Tool、Agent、权限、FileChange、错误和 IPC 草案。
- [x] 设计 SQLite 表、Artifact 与 SecretStore 边界。
- [x] 建立 Electron、路径、命令、网络、日志和供应链安全基线。
- [x] 规划阶段 2 至阶段 9 的入口/退出条件。

### 验证

阶段 1 只有 Markdown 文档，无 `package.json`、TypeScript 工程或可执行测试，因此不伪造
`pnpm lint/typecheck/test/build` 结果。验证项为：

- 三份文档存在且可读取。
- Markdown 围栏与主要章节完整。
- architecture、security、roadmap 对 MVP Provider 范围和密钥策略表述一致。
- 本阶段未创建源码、依赖、数据库或构建配置。

### 退出条件

- 产品负责人接受 MVP 范围裁决。
- 接受将 OpenAI Compatible 作为唯一 MVP Provider。
- 确认系统凭据库不可用时不降级到明文存储。
- 确认 AI 写入与命令都必须经过不可重放审批。

## 4. 阶段 2：工程初始化

### 入口条件

阶段 1 文档评审通过；Node.js/pnpm 版本、应用标识和许可证确定。

### 具体工作

1. 初始化 Git 与 pnpm workspace。
2. 创建 `apps/desktop` 和六个基础 package。
3. 配置 Electron + React + TypeScript + electron-vite。
4. 配置 Tailwind CSS、shadcn/ui 基础主题和图标。
5. 配置严格 TypeScript、ESLint、Prettier、Vitest、Playwright。
6. 配置 electron-builder 的 Windows/macOS 目标和应用元数据。
7. 创建安全 BrowserWindow、preload 最小 API 和一个类型安全 health IPC。
8. 建立组合根、统一 Result/AppError、日志脱敏骨架。
9. 建立 Windows/macOS CI 矩阵，尽早验证原生依赖。

### 建议基线命令

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

首次初始化还没有 lockfile 时先执行普通 `pnpm install`，提交 lockfile 后 CI 使用
`--frozen-lockfile`。

### 退出条件

- 开发模式可启动，Renderer 通过 preload 调用 health IPC。
- `contextIsolation=true`、`nodeIntegration=false`、sandbox 和 CSP 已验证。
- lint、typecheck、unit test、build 全通过。
- Playwright 可启动打包/开发应用并检查欢迎页。
- Windows 与 macOS CI 至少完成一次无签名测试构建。

## 5. 阶段 3：工作区和文件系统

### 具体工作

- 实现 Workspace Repository、打开目录和最近项目。
- 实现 canonical path、边界、敏感路径、软链接/junction 安全策略及测试。
- 实现增量文件树、忽略规则、文件读取、搜索和资源限制。
- 集成 Monaco，多标签页、脏状态和用户手动保存。
- Renderer 只通过 files/workspace IPC 访问文件。
- 添加工作区恢复、文件变化监听和外部修改冲突提示。

### 当前完成情况

- [x] 使用 SQLite + Drizzle 持久化最近工作区，并支持重启后重新打开。
- [x] 使用系统目录选择器打开工作区，保存 canonical path。
- [x] 建立增量文件树、目录展开/收起、文件名搜索和刷新。
- [x] 建立路径标准化、工作区边界、真实路径、软链接和敏感文件保护。
- [x] 通过类型安全 IPC 读取与原子保存 UTF-8 文本文件。
- [x] 集成本地 Monaco Editor、多标签、脏状态、查找替换和 `Ctrl/Cmd+S`。
- [x] 使用内容哈希拒绝覆盖外部修改。
- [x] 监听工作区文件变化；无本地修改时刷新编辑器，有本地修改时保留内容并提示冲突。
- [x] E2E 覆盖打开项目、文件树、编辑保存、外部变化和最近项目恢复。

### 阶段验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：6 个测试文件、24 个测试通过。
- `pnpm build`：通过。
- `pnpm exec playwright test`：2 个桌面 E2E 通过。
- Windows `win-unpacked` 重新生成，并使用独立可执行文件完成启动与主进程健康检查。

### 阶段边界

阶段 3 的保存是用户在编辑器中的直接操作。AI 生成的写入仍必须在阶段 6 进入
FileChange/Diff/审批/回滚事务，不能复用手动保存接口绕过审批。文件创建、删除、移动和内容搜索
将在工具与变更审核阶段按权限模型实现。

### 关键测试

- Windows 盘符/大小写/UNC/junction；macOS symlink。
- `..`、绝对路径、兄弟目录前缀、新文件父目录逃逸。
- `.env`、SSH key 和浏览器凭据默认拒绝。
- 大目录、大文件、二进制和搜索取消。
- 外部修改后保存冲突。

### 退出条件

用户能安全打开目录、浏览、搜索、查看和手动保存文本文件；所有路径安全测试通过。

## 6. 阶段 4：模型配置系统

### 具体工作

- 实现 `ProviderRegistry` 与契约测试套件。
- 实现 OpenAI Compatible 配置 Zod Schema 和独立 Adapter。
- 实现 SecretStore 系统凭据库 Adapter 与失败补偿。
- 创建 Provider 设置页：新增、编辑、删除、掩码、默认模型和能力开关。
- 实现连接测试、模型列表、SSE 流、取消、限流和统一错误映射。
- 自定义 Header 按敏感分类拆分存储。
- Provider 网络策略阻止危险 URL、重定向和凭据跨源。

### 当前完成情况

- [x] `ProviderRegistry`、统一 Provider 契约与重复/未知注册测试。
- [x] OpenAI Compatible Adapter：`GET /models`、流式/非流式
      `POST /chat/completions`、SSE Unicode/分片/工具参数/usage/`[DONE]`。
- [x] Provider 配置 SQLite Repository 和模块化 Provider/Chat IPC；所有参数与响应均由 Zod 校验。
- [x] Electron `safeStorage` 异步 Adapter；Windows DPAPI/macOS Keychain/Linux Secret Service
      或 KWallet 保护密钥，Linux `basic_text` 后端拒绝落盘。
- [x] API Key 与敏感 Header 使用新引用切换和失败补偿；Renderer、IPC 响应和公开配置不回读明文。
- [x] Provider 设置页支持新增、编辑、删除、掩码密钥、连接测试、模型列表、上下文和能力开关。
- [x] 工作台支持模型/配置切换、真实多轮流式对话、停止、重新生成、复制、Markdown 和代码高亮。
- [x] 网络策略拒绝远程 HTTP、URL 凭据、查询/片段、Hop-by-hop Header、重定向及私网/保留地址。
- [x] E2E 使用本地真实 HTTP/SSE 服务验证保存、重启恢复、连接、模型列表、流式聊天、停止和密钥不落明文。

### 阶段验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：12 个测试文件、40 个测试通过。
- `pnpm build`：通过。
- `pnpm exec playwright test`：3 个桌面 E2E 通过。
- `pnpm package:dir`：通过，已重新生成 Windows `win-unpacked`。
- 打包产物烟雾测试：通过；独立可执行文件显示欢迎页且页面错误为 0。

### 阶段边界

阶段 4 的对话记录当前只存在于本次 Renderer 会话中；历史会话、Agent 检查点和工具记录将在阶段 5
进入 SQLite。当前工具调用事件只展示“尚未执行”，不会绕过 ToolRegistry 或权限系统执行。

### 关键测试

- Registry 重复注册、未知 Provider 和能力返回。
- Secret 不出现在 SQLite、IPC、日志或 UI 状态。
- SSE 分块、Unicode、工具参数分片、`[DONE]`、错误和取消。
- 自定义端点 HTTP/私网/重定向策略。
- 使用本地测试服务器完成真实流式集成测试。

### 退出条件

用户可安全配置并测试一个 OpenAI Compatible Provider，选择模型并完成可取消的真实流式对话。

## 7. 阶段 5：Agent 和工具系统

### 具体工作

- 实现 Agent 状态机、检查点、停止、取消、重试和崩溃恢复。
- 实现 ContextBuilder、Token 预算、去重、截断和历史摘要接口。
- 实现 ToolRegistry、ToolDispatcher、Zod 参数校验和统一结果。
- 优先实现 `list_directory`、`read_file(s)`、`search_files`、`search_text`、
  `inspect_package`、`get_diagnostics`。
- 实现 PermissionService、审批 UI、输入摘要和审计。
- 保存 ToolCall、ToolResult 摘要、计划、错误与终端/工具轨迹。

### 当前完成情况

- [x] Agent 状态机覆盖分析、规划、工具执行、完成、失败和取消，非法状态迁移有单元测试。
- [x] Agent 在主进程中持有会话历史，支持最多 8 个模型回合、20 次工具调用和同一
      `AbortSignal` 级联取消。
- [x] 模型工具调用按“流式拼接 → JSON 解析 → Registry 查找 → Zod 校验 → 权限策略 →
      执行 → 结构化结果回送模型”闭环运行。
- [x] 七个工作区只读工具真实实现并注册：`list_directory`、`read_file`、`read_files`、
      `search_files`、`search_text`、`inspect_package`、`get_diagnostics`。
- [x] 只读工具继承阶段 3 的 canonical path、敏感路径、软链接和工作区边界保护，并增加
      文件数、结果数、字符数、单文件大小与取消限制。
- [x] ContextBuilder 实现中英文粗略 Token 估算、优先级、内容去重、预算截断和被淘汰历史
      的确定性摘要；不会自动扫描并发送整个项目。
- [x] `conversations`、`messages`、`agent_tasks`、`tool_calls` 已进入带
      `PRAGMA user_version` 的 SQLite 迁移；异常退出中的任务在下次启动时标记为可重试失败。
- [x] UI 支持新建、选择、重命名、软删除、Markdown 导出和重启后恢复会话，并显示 Agent
      状态、上下文预算、工具参数、工具状态和错误。
- [x] OpenAI Compatible 同时支持流式和非流式工具调用响应，且能序列化 assistant
      `tool_calls` 与 `tool` 结果继续下一回合。
- [x] 本地真实 HTTP/SSE 集成测试与 Electron E2E 覆盖 `read_file` 两轮闭环、停止任务、
      密钥不落明文和应用重启后的会话/工具轨迹恢复。

### 阶段验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：18 个测试文件、50 个测试通过。
- `pnpm build`：通过。
- `pnpm exec playwright test`：3 个桌面 E2E 通过。
- `pnpm package:dir`：通过，Windows `win-unpacked` 已重新生成。
- 打包产物烟雾测试：通过，独立 `OpenCode Desk.exe` 成功显示主进程健康状态
  `主进程连接正常 · v0.1.0`。

### 阶段边界

阶段 5 只注册无副作用的只读工具。`DefaultPermissionPolicy` 会自动允许 read、要求
write/execute 审批并默认拒绝 dangerous，但写入与命令工具尚未注册，因此当前不会产生虚假的
审批弹窗。模型返回的普通文本、未知工具、畸形 JSON 或未通过 Zod 的参数都不能写文件或执行命令。

文件写工具必须先形成可审阅的 FileChangeSet，故与 Diff、审批摘要、原子应用和回滚一起在阶段 6
实现；命令审批在阶段 7 实现。该切分避免先提供可绕过 Diff 的直接写工具。

### 退出条件

Agent 能在预算内通过只读工具完成多轮任务；未知或畸形工具调用不会执行；取消、失败记录和重启后
恢复为可重试状态可靠。

## 8. 阶段 6：代码变更审核

### 实施结果（2026-07-30）

- [x] `FileChangeSet`/`FileChange` 领域状态、SQLite Repository 与增量迁移已实现。
- [x] `create_file`、`update_file`、`delete_file`、`move_file`、`apply_patch` 仅创建提案，
      不直接写工作区。
- [x] Renderer 使用 Monaco Diff Editor 显示原始/拟议内容，并支持逐文件/批量批准、拒绝及
      编辑拟议内容。
- [x] 审批摘要绑定工作区、会话、任务、操作、路径、基线哈希和拟议内容哈希；编辑后摘要失效。
- [x] 应用前统一校验全部基线；同目录临时文件、快照 Artifact 与 Saga 补偿保证部分失败可恢复。
- [x] 支持 create/update/delete/rename 的应用、历史展示、最近变更回滚和启动时中断事务恢复。
- [x] 已覆盖第二个写入失败、目标锁定、审批后外部修改、回滚前再次编辑、进程中断恢复和四类文件操作测试。
- [x] 桌面 E2E 已验证真实模型工具调用 → Diff → 批准 → 应用 → 回滚 → 重启后历史恢复。

### 具体工作

- 实现 FileChangeSet 聚合、状态机和 Repository。
- 模型写工具只生成提议，不直接写目标文件。
- 实现 unified diff、Monaco Diff Editor、逐文件/全部审批、拒绝和用户编辑。
- 实现 Artifact、基线哈希、临时写入、快照、补偿事务和启动恢复。
- 实现最近一次变更回滚与历史记录。
- 删除、重命名、大文件和二进制操作单独处理风险。

### 关键故障注入

- 第二个文件写入失败。
- 目标文件被锁定。
- 审批后目标内容改变。
- 应用中进程退出并重新启动。
- 回滚前文件又被用户编辑。

### 退出条件

未经批准的 AI 修改无法落盘；批准的多文件变更要么完成，要么可证明恢复；冲突不会覆盖用户内容。

## 9. 阶段 7：终端和 Git

### 具体工作

- 集成 xterm.js 与跨平台 PTY Adapter。
- 将用户交互终端和 Agent 命令 Runner 分离。
- 实现结构化 `run_command`/`run_tests`、危险分类、审批、超时、取消和进程树清理。
- 实现白名单/禁止规则和最小环境变量。
- 实现 simple-git Status/Diff 的只读 Adapter。
- 允许经用户选择的终端输出、Git Diff 和诊断进入 ContextBuilder。

### 退出条件

AI 只能执行审批内容完全一致的命令；输出可实时查看和取消；Git 只读能力可用且错误可读。

## 10. 阶段 8：其他模型适配器

### 顺序

1. OpenAI
2. Anthropic Claude
3. Google Gemini
4. DeepSeek
5. OpenRouter
6. 阿里云通义千问
7. 智谱 GLM
8. Moonshot/Kimi
9. Ollama

排序可按真实用户优先级调整，但每个 Adapter 均须：

- 独立目录、配置 Schema、错误映射和能力策略。
- 文本/工具/视觉等消息转换。
- 流式、取消、超时、用量和限流测试。
- 使用本地协议 Fixture 的契约测试；有测试凭据时运行可选的真实冒烟测试。
- 不修改 Agent 核心流程；若必须修改，先评审 Provider 契约是否不足。

### 退出条件

只有通过共同契约测试的 Provider 才在 UI 标为可用；部分兼容能力必须明确显示，而非静默降级。

## 11. 阶段 9：测试、文档和打包

### 具体工作

- 补齐单元、集成、E2E、安全和故障注入测试。
- 完成 README、安装说明、Provider 开发文档、故障排查和隐私说明。
- 验证 SQLite 迁移、清理、导出和会话恢复。
- 完成 Windows 安装包和 macOS DMG/ZIP。
- 设置 Windows 签名、macOS 签名/notarization 的安全 CI Secret 流程。
- 生成 SBOM、依赖/Secret 扫描报告和产物校验和。
- 在干净 Windows/macOS 机器执行完整验收。

### 发布门槛

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm build`
- Windows/macOS 打包验证
- 高危安全问题为零，已知风险有明确接受记录

## 12. MVP 端到端验收矩阵

| #   | 用户流程               | 预期证据                                  |
| --- | ---------------------- | ----------------------------------------- |
| 1   | 安装并启动             | 双平台安装记录、首屏截图、无安全告警      |
| 2   | 选择本地项目           | 原生目录选择器和 canonical workspace 记录 |
| 3   | 进入模型设置           | 页面导航 E2E                              |
| 4   | 选择 Provider          | Registry 返回 OpenAI Compatible           |
| 5   | 填 Base URL、Key、模型 | IPC 不含回读密钥，Key 仅进系统凭据库      |
| 6   | 验证连接               | 本地测试 Provider 和可读错误用例          |
| 7   | 创建会话               | SQLite 会话记录                           |
| 8   | 输入需求               | 消息持久化且流任务创建                    |
| 9   | AI 读取相关文件        | ToolCall 记录、路径策略审计               |
| 10  | AI 给出计划            | 流事件和恢复后消息一致                    |
| 11  | AI 生成修改            | FileChangeSet 处于 pending                |
| 12  | 显示 Diff              | Monaco Diff 显示原始/拟议内容             |
| 13  | 批准或拒绝             | 摘要绑定的 Permission/Review 记录         |
| 14  | 批准后写入             | 哈希、Artifact、应用与回滚测试            |
| 15  | AI 请求测试命令        | 结构化 executable/args/cwd                |
| 16  | 用户批准               | 审批摘要与 spawn 参数一致                 |
| 17  | 显示测试结果           | 实时输出、exit code、取消/超时            |
| 18  | 保存记录               | 会话、工具、变更、命令均可查询            |
| 19  | 重启后恢复             | Playwright 重启场景                       |
| 20  | 更换/新增模型          | 多配置切换且 Secret 相互隔离              |

## 13. 阶段报告模板

每阶段完成时按下列顺序报告：

1. 本阶段目标。
2. 已完成内容。
3. 创建或修改的文件。
4. 关键架构决策。
5. 实际执行过的命令。
6. 测试结果。
7. 类型检查结果。
8. 尚未完成的问题。
9. 已知风险。
10. 下一阶段建议。

报告必须包含准确的命令退出码或摘要。未运行写“未运行及原因”，失败写清失败项，不得以
“基本完成”“理论通过”替代证据。

## 14. 建议里程碑

不在阶段 1 给出未经仓库、人员和 CI 环境验证的日历承诺。建议使用以下可验收里程碑：

- **M0 架构冻结**：阶段 1 文档评审通过。
- **M1 安全桌面壳**：阶段 2 完成。
- **M2 本地编辑器**：阶段 3 完成。
- **M3 模型可用**：阶段 4 完成。
- **M4 Agent 只读闭环**：阶段 5 完成。
- **M5 可审阅写入闭环**：阶段 6 完成。
- **M6 命令与 Git 闭环**：阶段 7 完成，此时达到功能型 MVP。
- **M7 多 Provider**：阶段 8 完成。
- **M8 发布候选**：阶段 9 完成。

## 15. 下一阶段开始前的具体决策

阶段 2 开始前需要确认或采用默认值：

- 包管理器：默认 pnpm。
- Node.js：选择当期维护中的 LTS，并在 `.nvmrc`/`packageManager` 固定。
- 应用 ID：建议 `dev.opencode.desk`，发布前确认命名权。
- 许可证与代码签名主体。
- UI 语言策略：建议 MVP 简体中文，文案键预留国际化。
- SQLite、PTY、系统凭据库的具体库需做 Electron ABI/双平台 Spike。
- 是否允许 MVP 的自定义 Provider 访问非本地 HTTP：建议不允许。
- 会话/Artifact 默认保留时长和永久清除交互。

默认值不会放宽 [security.md](./security.md) 的密钥、审批、路径或命令边界。
