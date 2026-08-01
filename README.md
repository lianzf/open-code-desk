# OpenCode Desk

OpenCode Desk 是一款本地优先、审批驱动的跨平台 AI 编程桌面工具。它使用 Electron、React 和 TypeScript 构建，允许用户自行配置模型服务地址、API Key 与模型名称，并通过统一 Provider 和 Tool 契约扩展新的模型或编程工具。

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
- 查看 Git 分支、工作区状态和 Diff
- 持久化工作区、模型配置、会话、Agent 任务、工具调用、文件变更、命令记录、权限规则和审计日志
- 支持主题、界面语言、快捷键、崩溃记录和受控自动更新

IDE 级项目识别、运行配置、进程运行和 DAP 调试正在按独立模块建设。在真实断点、调用栈、变量和单步调试闭环完成前，本项目不会把普通终端命令描述为 IDE 调试能力。

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
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 会先构建桌面端，再运行 Playwright Electron 场景。真实模型协议测试使用本地 HTTP/SSE 测试服务，不要求开发者提供真实厂商密钥。

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

跨平台正式发布应在对应原生 CI runner 上构建。公开发布前还必须配置 Windows 代码签名、macOS 签名与 notarization，并在干净设备上完成安装、启动、卸载和更新验证。

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
- 命令使用结构化 executable/args 且 `shell: false`，高风险模式会拒绝或单独确认
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

当前仓库包含打包配置和 CI 任务，但正式发布仍需要发布者提供平台签名证书并完成干净机器验收。未签名构建仅用于开发和测试。

### 可以添加新的模型服务商吗？

可以。实现独立 Provider Adapter、配置 Schema、注册表注册、配置表单和契约测试即可；Agent、文件变更和权限主流程不应出现新的厂商分支。

## 文档

- [系统架构](docs/architecture.md)
- [安全设计](docs/security.md)
- [开发路线图](docs/roadmap.md)

## 当前限制

- IDE 项目运行、DAP 断点调试和 AI 调试上下文仍在开发中
- 正式 Windows/macOS 发布需要代码签名、notarization 和干净设备验收证据
- 4 小时稳定性、10,000 文件性能与完整跨平台安装报告尚未形成发布门槛证据
- 部分工作台文案尚未完全国际化

## 许可证

当前 `package.json` 标记为 `UNLICENSED`。在项目选择并提交明确的开源许可证之前，不应假定代码已获得公开再分发授权。
