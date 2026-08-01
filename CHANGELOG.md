# 更新日志

本文档记录 OpenCode Desk 各阶段版本的用户可见变化。版本遵循语义化版本规范；正式版发布前使用预发布标识。

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
