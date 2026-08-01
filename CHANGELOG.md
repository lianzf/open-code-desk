# 更新日志

本文档记录 OpenCode Desk 各阶段版本的用户可见变化。版本遵循语义化版本规范；正式版发布前使用预发布标识。

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
