# 0.7.0-alpha.1 发布就绪审计

日期：2026-08-02（公共三平台 CI 复验：2026-08-04）
审计对象：本地 `release/0.7.0-alpha.1` 工作树  
结论：核心产品闭环、本地质量门禁和当前提交的三平台公共 CI 已通过，但当前构建不能标记为正式版完成。

## 已验证能力

- 10 个计划内 Provider 已注册：OpenAI Compatible、OpenAI、Anthropic、Gemini、OpenRouter、DeepSeek、Qwen、GLM、Moonshot/Kimi 和 Ollama；模型能力解析具有自动识别与用户配置回退。
- 项目规则文件、图片上下文、任务恢复、失败步骤重试、权限审批、审计日志、自动更新、本地崩溃报告、主题、快捷键和核心界面双语切换均有真实实现。
- Node.js/TypeScript、Python、浏览器前端与 Electron 主/渲染进程使用随包真实 DAP；React、Vue、Next.js 端口型配置可编排经审批的开发服务器和本机 Chrome/Edge，Electron 以同一 js-debug 服务管理 `pwa-node` 与 `pwa-chrome` 双客户端。Windows 已完成 Chrome、Electron、Java/JDT LS、C/C++/Rust LLVM/LLDB、Go/Delve 和 .NET/NetCoreDbg 的真实断点、变量与清理验收，适用路径还验证了单步。项目任务、组合运行、端口冲突处理、高级断点、异常规则、调试上下文与 AI Diff 审核形成持久化闭环。
- Windows、macOS 和 Linux 均有 electron-builder 目标；CI 使用对应原生 runner 构建 NSIS、DMG/ZIP 和 AppImage，并上传 SHA-256 摘要。
- `12841daffc7082e532ed1a355ab2b09a7b67e015` 的 CI run `30892174210` 已在 Windows x64、macOS ARM64、Linux x64 完成真实 Java 调试、安装包构建、运行时完整性和已打包应用 E2E，四个 job 全部成功。
- 命令允许规则精确绑定可执行文件、工作目录和完整参数；历史宽泛允许规则升级后失效，拒绝规则仍可宽泛阻断。
- Provider JSON/SSE 响应按原始字节流执行限额，并在响应头之后继续执行正文停滞与总体时长限制；当前工作区服务不再把历史工作区 ID 当作磁盘访问授权。

## 本地门禁记录

| 检查                             | 结果                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `pnpm format:check`              | 通过                                                  |
| `pnpm docs:check`                | 11 必需文档 / 45 链接通过                             |
| `pnpm lint`                      | 通过                                                  |
| `pnpm typecheck`                 | 通过                                                  |
| `pnpm test`                      | 111 文件 / 381 测试通过；7 个门禁文件 / 18 项默认跳过 |
| `pnpm test:integration`          | 29 文件 / 92 测试通过                                 |
| 真实 Chrome 调试门禁             | 显式启用后 1 / 1 通过                                 |
| 真实 Electron 双进程调试门禁     | 显式启用后 1 / 1 通过                                 |
| 真实 Java 调试门禁               | 显式启用后 1 / 1 通过                                 |
| 真实 Go/Delve 调试门禁           | 显式启用后 1 / 1 通过                                 |
| 真实 .NET/NetCoreDbg 调试门禁    | 显式启用后 1 / 1 通过                                 |
| 真实 C/C++/Rust LLDB 调试门禁    | 显式启用后 3 / 3 通过                                 |
| `pnpm test:performance`          | 10,000 文件验收通过                                   |
| `pnpm test:stability`            | v12：1 passed (4.0h)                                  |
| `pnpm build`                     | 通过                                                  |
| `pnpm exec playwright test`      | 16 / 16 通过                                          |
| `pnpm security:dependency-audit` | 710 项 / 全部严重级别 0                               |
| `pnpm security:secrets`          | 554 文件 / 0 未允许发现                               |
| `pnpm security:licenses`         | 149 组件 / 0 待复核                                   |
| CycloneDX 1.6 SBOM               | 588 组件 / Schema 通过                                |
| 桌面打包生产依赖                 | 15 / 15 可解析                                        |
| Windows 打包运行时完整性         | 通过                                                  |
| Linux x64 AppImage/运行时完整性  | 通过                                                  |
| Linux 已打包应用核心 E2E         | 9 / 9 通过                                            |
| Linux GNOME Secret Service       | 写入、读取、清除通过                                  |
| `git diff --check`               | 通过                                                  |

10,000 文件基准的完整指标见[性能验收报告](performance-2026-08-02.md)。

## 正式发布门槛判定

| 门槛                              | 当前证据                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 判定                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 连续运行 4 小时无明显内存泄漏     | 隔离、自报告的 v12 于 2026-08-03 09:41:39–13:42:09 完成：240 分钟、20 个会话、13,643 次 soak 迭代、242 个内存样本；Heap 35.84→24.44 MiB（增长 -11.40 MiB，门槛 +256 MiB），RSS 228.87→57.17 MiB（增长 -171.70 MiB，门槛 +512 MiB）；24 个验收心跳、480 个原生心跳；页面错误、Renderer 崩溃、窗口无响应、`render-process-gone`、失败标记和 stderr 均为 0；自报告退出码 0，`1 passed (4.0h)`，相关残留进程 0；证据为 `.runtime/stability-final-v12.*`           | 满足（Windows 4 小时基线）                                                        |
| 当前源码对应的 Windows 安装包     | 2026-08-03 22:29:30 重建 0.7 NSIS；183,382,946 字节；SHA-256 `0076E23B269D4878826191CE69DE975142B49991A55160356D9E380EE27D34AA`；目标可执行文件、`app.asar`、js-debug、debugpy、JDT LS、Java Debug Server 和 win32-x64 `node-pty` 原生模块完整性校验通过；9/9 已安装应用核心 E2E 与 6/6 桌面壳/持久化 E2E 通过，冷启动 1.61 秒，正常关闭残留进程 0，静默卸载退出码 0；Secret 扫描 530 文件且未允许发现为 0；710 项完整 workspace 依赖审计的所有严重级别均为 0 | 本地未签名候选通过                                                                |
| Windows 正式签名                  | 现有 0.7 NSIS 的 Authenticode 状态为 `NotSigned`；`Cert:\CurrentUser\My -CodeSigningCert` 计数为 0，`CSC_LINK`/`CSC_KEY_PASSWORD` 均未配置；GitHub Environments 查询总数为 0，工作流引用的 `release-signing` 环境尚不存在                                                                                                                                                                                                                                     | 未满足                                                                            |
| macOS 正式签名与 notarization     | 配置包含 hardened runtime 和 DMG/ZIP 目标，但本机没有 macOS 原生环境；`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 均未配置；仓库也没有 `release-signing` Environment，因而没有本轮签名/notarization 与干净设备证据                                                                                                                            | 未满足                                                                            |
| 当前源码对应的 Linux x64 AppImage | 本地 Debian 12 Docker 证据仍保留；公共 CI run `30892174210` 又在 Linux x64 原生 runner 完成 JDK 21 Java 调试、AppImage 构建、运行时完整性、已打包应用 E2E 与 artifact 上传。                                                                                                                                                                                                                                                                                  | 满足“Linux 至少可构建”及公共原生 CI 自动化证据；仍非公开 Release/独立人工设备证据 |
| 当前源码对应的 macOS 产物         | CI run `30892174210` 在 `macos-15` ARM64 以 JDK 21 完成真实 Java 调试，生成 DMG/ZIP，验证 JDT LS、Java Debug Server、`node-pty` 原生 helper 的格式与执行权限，并完成已打包应用 E2E；artifact `open-code-desk-macos-arm64` 已上传。                                                                                                                                                                                                                            | 当前提交的原生自动化已满足；仍未签名/notarize，也没有独立人工设备证据             |
| 全部计划 Provider 公网验收        | 当前环境未配置 Provider 凭据；现已提供覆盖 10 个 Provider 的显式选择门禁，逐项验证连接/模型列表和最多 32 token 的流式响应，并限制为 60 秒、禁止输出回复正文、对 API Key 和自定义 Header 值执行失败脱敏。默认跳过仅证明无意外网络访问，适配器、协议测试和本地真实 HTTP 流程仍不能替代提供真实凭据后的公网运行证据                                                                                                                                              | 验收基础设施已具备；缺少用户提供的测试凭据与实际通过记录                          |
| 独立人工完整闭环                  | 自动化 E2E 覆盖核心 AI 编程与调试流程，但当前没有独立验收人员在干净 Windows/macOS 设备上的完整记录                                                                                                                                                                                                                                                                                                                                                            | 缺少独立人员与干净设备证据                                                        |
| 0.7 GitHub Release                | 远端最新 Release 为 0.6.0-alpha.1；当前三平台 CI artifact 已齐备                                                                                                                                                                                                                                                                                                                                                                                              | 未满足；签名、notarization 与独立验收完成前不发布                                 |
| 单个业务文件原则上不超过 400 行   | 排除测试、产物和 vendor 后，TypeScript/TSX 生产源码超过 400 行的文件为 0；主进程、Preload、IPC 合同、数据库、运行/调试/任务服务、Store 与工作台 UI 已按职责拆分                                                                                                                                                                                                                                                                                               | 满足                                                                              |
| 完整双语动态诊断                  | 核心静态界面已双语化，Renderer 错误展示点统一经过本地化边界；应用自有的主进程/DAP 英文与中文诊断均受双向源码覆盖门禁约束，项目检测、Python 解释器说明、命令风险、工具批准原因和命令服务诊断有双语测试。第三方原始诊断按原文保留                                                                                                                                                                                                                               | 满足；产品自有诊断已完成双向覆盖，第三方技术细节按原文保留                        |
| 正式版逐步语言调试范围            | Node.js/TypeScript、Python、浏览器前端、Electron 主/渲染进程、Java、C/C++/Rust、Go、.NET 均已接入并完成 Windows 真实断点、栈、变量与清理验收；Java 还在 macOS ARM64/Linux x64 公共 runner 完成断点、变量、单步、异常与清理。Node Inspector 远程/容器附加已验证；其他语言跨环境附加和自动隧道尚未接入                                                                                                                                                          | 本地语言范围与 Java 三平台自动化满足；跨环境路线部分完成                          |

## 远端证据边界

2026-08-04 使用当前 GitHub 身份重新只读查询：产品代码提交 `12841daffc7082e532ed1a355ab2b09a7b67e015` 已推送到远端 `release/0.7.0-alpha.1`；CI run `30892174210` 的 Quality gates、Windows x64、macOS ARM64、Linux x64 四个 job 均成功，并上传三平台产物与质量/安全元数据。最新 Release 仍为 `v0.6.0-alpha.1`，仓库 Environment 与 Secret 名称查询均为空。

## 发布判定

当前可以作为具备三平台公共 CI 证据的 0.7 alpha 候选继续验收，不能标记为正式版完成。公共原生 CI、三平台产物、Windows 安装烟测、结构性债务与 4 小时稳定性门槛已处理；仍须提供 Windows/macOS 正式签名与 notarization 输入、全部计划 Provider 的真实公网通过记录，以及独立验收人员在干净设备上的完整 AI 编程与调试闭环记录。
