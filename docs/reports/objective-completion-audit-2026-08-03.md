# 项目目标完成度审计

日期：2026-08-03（当前候选完成审计复核：2026-08-08）
目标来源：`goal-objective.md`，1,664 行，SHA-256
`0BA834EC5E45CD7F86693D5E2B36F3CCAF6E36249D33B992F00A8B7D4E5AF038`

## 审计结论

产品提交 `07ac06281374f6284c42f5c50b2d44141014e9a7` 已形成可安装、可运行、可配置、具备真实 AI 编程闭环和 Node.js/Python/浏览器/Electron 主渲染双进程 DAP 调试闭环的 0.7 alpha 候选。Windows 已完成 Java、C/C++/Rust、Go、.NET 的真实 DAP 验收；公共 CI run `31247288230` 在 Windows x64、macOS ARM64 和 Linux x64 原生 runner 完成冻结依赖安装、真实 Java 调试验收、NSIS/DMG/ZIP/AppImage 构建、目标运行时完整性校验及已打包应用 E2E。核心自动化、性能、安全静态门禁、4 小时稳定性、安装后验收和 400 行结构约束均已通过。

该 CI 的 Quality gates 成功，三个平台 job 也只在最终 `Upload installer` 因 GitHub Actions artifact 存储配额失败，因此不能声称当前候选 CI 全绿或三平台制品已齐备。当前产品提交 `07ac062` 的 Windows NSIS 已在本机全新构建并完成清单、签名状态、安装、冷启动、卸载、已安装核心 E2E 与桌面壳/持久化 E2E 验证；当前提交的公共 Windows/macOS/Linux 精确制品仍需释放配额后重新上传并下载核验。

项目仍不能标记为正式完成。以下硬证据尚缺失：

1. Windows Authenticode、macOS 签名与 notarization 未完成；本机代码签名证书为 0，Apple/CSC 签名输入均未配置；GitHub Environments 与仓库 Secret 名称只读查询均为空，`release-signing` 环境尚不存在。
2. 尚无干净 Windows/macOS/Linux 设备和独立验收人员的完整人工闭环记录；公共原生 runner 自动化不能替代目标要求的独立人工操作记录。
3. 全部计划 Provider 的真实公网凭据连接未逐一验收；当前环境没有任何对应验收环境变量。现有 10 个 Provider 门禁具备显式选择、60 秒超时、最小流式请求和失败脱敏，但默认跳过不能替代真实凭据运行证据。
4. 用户已授权删除 run `30933901524` 的 4 个旧 artifact；远端当前保留 run `30944352985` 的 5 个历史关键 artifact、共 803,368,696 字节，本地仍保留被删 run 的完整备份。run `31247288230` 的质量元数据和三平台安装包因 GitHub 计量尚未重算而未上传，官方错误提示需等待删除后 6–12 小时。

Renderer 错误展示点已统一经过本地化边界；应用自有的主进程/DAP 英文与中文诊断均受双向源码覆盖测试约束，项目检测、命令风险和工具批准原因也有双语测试。第三方原始诊断按原文保留，因此产品自有动态诊断的完整双语要求已满足。

2026-08-04 使用当前 GitHub 身份重新执行只读核验：产品代码提交 `319a25d277de1d610aae877b92c30452dd647518` 已推送到远端 `release/0.7.0-alpha.1`；CI run `30914375533` 的 Quality gates、Windows x64、macOS ARM64、Linux x64 四个 job 全部成功，并上传约 182.6 MB、409.1 MB、212.6 MB 的三平台 artifact。最新发布仍为 `v0.6.0-alpha.1`，仓库 Environment 和 Secret 名称总数均为 0。

2026-08-08 复核：远端 `release/0.7.0-alpha.1` 当前产品提交为 `07ac06281374f6284c42f5c50b2d44141014e9a7`。CI run `31247288230` 的 Quality gates job `93077871336` 成功；Windows `93078366593`、macOS `93078366590`、Linux `93078366585` 的产品步骤全部通过，仅 artifact 上传失败。Windows 已安装应用 E2E 也验证了 DAP `exited`/`terminated` 输出顺序修复。最新 Release 仍为 `v0.6.0-alpha.1`，`v0.7.0-alpha.1` tag 不存在，仓库 Environment 与 Actions Secret 名称仍为空。

## 当前权威基线

| 证据                               | 当前结果                                                  |
| ---------------------------------- | --------------------------------------------------------- |
| `pnpm format:check`                | 通过                                                      |
| `pnpm docs:check`                  | 12 必需文档 / 50 链接通过                                 |
| `pnpm lint`                        | 通过，0 error / 0 warning                                 |
| `pnpm typecheck`                   | 7 个工作区项目通过                                        |
| `pnpm build`                       | 通过                                                      |
| `pnpm test`                        | 113 个文件 / 394 项测试通过；7 个门禁文件 / 18 项默认跳过 |
| `pnpm test:integration`            | 29 个文件 / 94 项测试通过                                 |
| 真实 Chrome 调试门禁               | 显式启用后 1 / 1 通过                                     |
| 真实 Electron 双进程调试门禁       | 显式启用后 1 / 1 通过                                     |
| 真实 Java 调试门禁                 | 显式启用后 1 / 1 通过                                     |
| 真实 Go/Delve 调试门禁             | 显式启用后 1 / 1 通过                                     |
| 真实 .NET/NetCoreDbg 调试门禁      | 显式启用后 1 / 1 通过                                     |
| 真实 C/C++/Rust LLDB 调试门禁      | 显式启用后 3 / 3 通过                                     |
| `pnpm test:performance`            | 10,000 文件验收通过                                       |
| `pnpm test:stability`              | v12：1 passed (4.0h)                                      |
| `pnpm exec playwright test`        | 16 / 16 Electron E2E 通过                                 |
| 安装后核心 E2E                     | 9 / 9 通过                                                |
| 安装后桌面壳与持久化 E2E           | 6 / 6 通过                                                |
| Windows 打包运行时完整性           | 通过                                                      |
| 公共 Windows x64 打包/安装态 E2E   | CI run `31247288230` 产品步骤通过；artifact 上传失败      |
| 公共 macOS ARM64 打包/应用 E2E     | CI run `31247288230` 产品步骤通过；artifact 上传失败      |
| 公共 Linux x64 打包/应用 E2E       | CI run `31247288230` 产品步骤通过；artifact 上传失败      |
| Linux x64 AppImage 打包/自解包     | 通过                                                      |
| Linux 打包运行时完整性             | 通过                                                      |
| Linux 已打包应用核心 E2E           | 9 / 9 通过                                                |
| Linux GNOME Secret Service         | 写入、读取、清除通过                                      |
| `pnpm security:dependency-audit`   | 710 项 / High 0 / Critical 0 / Moderate 1                 |
| `pnpm security:secrets`            | 560 文件 / 0 未允许发现                                   |
| `pnpm security:licenses`           | 149 组件 / 0 待复核                                       |
| CycloneDX 1.6 SBOM                 | Windows 588 / Linux 587 组件，Schema 通过                 |
| `git diff --check`                 | 通过                                                      |
| TypeScript/TSX 生产文件大于 400 行 | 0                                                         |
| Windows NSIS 冷启动                | 3.99 秒                                                   |
| Windows 正常退出残留进程           | 0                                                         |
| Windows 静默卸载                   | 退出码 0                                                  |
| Windows 安装包签名                 | `NotSigned`                                               |

当前产品候选 Windows 安装包 SHA-256：
`3F351D2B9B895A516DFE5587BD6304FD3B13F69F90DF0DF2D7F33D9617732223`（提交
`07ac06281374f6284c42f5c50b2d44141014e9a7`，182,383,713 字节；本机全新构建后重算与随包
`SHA256SUMS.txt` 6/6 一致；Authenticode 为 `NotSigned`；证据目录为
`D:\release-evidence\open-code-desk-local-07ac06281374f6284c42f5c50b2d44141014e9a7-windows-x64`）。

当前产品候选的 Linux x64 AppImage 已在 run `31247288230` 构建并完成已打包应用 E2E，但上传失败，
因此尚无可下载文件可供独立重算 SHA-256；旧候选的 Linux artifact 仅作为历史证据保留。

当前产品候选同一安装包的核心 E2E 完整重跑为 9/9，桌面壳与持久化扩展 E2E 为 6/6。早期候选最终运行前，一次连续套件中的
项目运行用例曾在 5 秒内未观察到进程输出；该用例单独完整重跑通过，随后同一安装包的 9 项核心套件
完整通过。这里保留该时序抖动记录，不把失败轮次隐藏为成功证据。

桌面壳套件还曾因测试点击 Monaco 的渲染层而两次未把输入焦点交给编辑器；测试已改为点击可交互的
编辑器容器，同一安装包随后完整重跑 6/6 通过。该问题属于 E2E 定位器缺陷，不是产品保存失败。

Linux 首轮 E2E 使用 Docker 默认 64 MiB `/dev/shm`，Monaco Diff 场景出现 Renderer 崩溃；按
Playwright 的 Docker 建议改用共享 IPC 后原失败场景 2/2 通过。完整套件随后暴露运行测试在首次
100 ms 心跳前关闭应用的竞态；测试增加“心跳文件已出现”前置断言后，单项 1/1 和完整套件 9/9
通过。保留上述失败轮次，不把基础设施限制或测试竞态记作产品成功。

## 原始功能验收域

| 目标域          | 判定                                                         | 当前证据或缺口                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面端基础能力  | 三平台产品自动化已证明；当前 artifact、正式签名/人工验收仍缺 | Windows NSIS、macOS ARM64 DMG/ZIP、Linux x64 AppImage 已由当前产品提交的公共原生 CI 构建并完成运行时与已打包应用 E2E；上传因配额失败。Windows 另有当前产品树的本地安装、启动、关闭、卸载证据                   |
| 本地项目管理    | 已证明                                                       | `desktop-launch.spec.ts` 覆盖打开、恢复、文件操作、路径授权和可取消搜索                                                                                                                                        |
| 代码编辑器      | 已证明核心闭环                                               | Monaco、多标签、保存、只读/Diff、断点和布局均进入 Electron E2E                                                                                                                                                 |
| 模型配置系统    | 已证明本地协议闭环                                           | 10 个 Provider 注册；连接、模型列表、流式响应和工具调用有单元/集成/E2E；新增 10 个默认禁用的真实服务门禁，仍需提供凭据后形成公网验收证据                                                                       |
| API Key 安全    | 已证明三平台自动化闭环                                       | `safeStorage`、密钥仓库、脱敏和安装版 Provider E2E；静态检查没有硬编码 `sk-…` 密钥；Linux Secret Service 与 macOS Keychain 路径均在对应原生 runner 的已打包应用 E2E 中通过                                     |
| AI 对话系统     | 已证明                                                       | 真实本地 HTTP 流式 Provider、工具循环、停止与重启恢复由 `provider-chat.spec.ts` 覆盖                                                                                                                           |
| 项目上下文      | 已证明核心闭环                                               | 文件、选择区、终端、Git、诊断上下文与有界构建测试齐全；10,000 文件验收确认不会预载整个项目                                                                                                                     |
| Agent 任务      | 已证明核心闭环                                               | Agent 状态、工具循环、命令审批、文件提案和恢复有集成/E2E                                                                                                                                                       |
| 内置工具        | 已证明核心集合                                               | Tool Registry、Zod 输入、文件/Git/命令工具及审计有自动化覆盖                                                                                                                                                   |
| 权限控制        | 已证明核心边界                                               | 工作区路径策略、外部目录授权、命令风险与批准/拒绝/取消有测试与 E2E                                                                                                                                             |
| 文件修改与 Diff | 已证明                                                       | 未批准不落盘、逐项审核、事务应用、回滚和历史由单元/集成/E2E 覆盖                                                                                                                                               |
| 终端            | 已证明                                                       | 真实 PTY、实时输出、隔离、退出码、终止和进程树清理由集成/E2E 覆盖                                                                                                                                              |
| Git             | 已证明                                                       | 真实仓库 status、staged/untracked 和有界 diff 集成测试及 E2E 通过                                                                                                                                              |
| 数据持久化      | 已证明核心闭环                                               | SQLite migrations、设置、对话、运行、任务、断点和调试记录恢复均有测试                                                                                                                                          |
| 错误处理        | 已证明                                                       | Provider/文件/命令/运行/调试返回结构化错误；Renderer 已无直接展示 `error.message` 的通路，应用自有的主进程/DAP 中英文诊断受双向源码覆盖门禁约束，规范化命令风险/批准原因支持双向显示；第三方技术诊断按原文保留 |

## 非功能验收域

| 目标域        | 判定                      | 当前证据或缺口                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 性能          | 已证明 Windows 基线       | 10,000 文件增量树、名称搜索、取消与内存门槛通过；详见[性能报告](./performance-2026-08-02.md)                                                                                                                                                                                                                                                |
| 稳定性        | 已证明 Windows 4 小时基线 | v12 于 2026-08-03 09:41:39–13:42:09 完成：240 分钟、20 个会话、13,643 次 soak 迭代、242 个内存样本；Heap 35.84→24.44 MiB（增长 -11.40 MiB，门槛 +256 MiB），RSS 228.87→57.17 MiB（增长 -171.70 MiB，门槛 +512 MiB）；24 个验收心跳、480 个原生心跳，错误与 stderr 均为 0，退出码 0，相关残留进程 0；证据为 `.runtime/stability-final-v12.*` |
| Electron 安全 | 已证明本地静态与测试基线  | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、CSP、可信 Renderer IPC；无 `eval`、`new Function`、`shell: true` 和显式 `any`                                                                                                                                                                                          |
| 可维护性      | 已证明当前结构门槛        | 排除测试、产物与 vendor 后，生产 TypeScript/TSX 超过 400 行的文件为 0                                                                                                                                                                                                                                                                       |
| 可扩展性      | 已证明架构边界            | Provider、Tool 和 Debug Adapter 使用 Registry/独立 Adapter；Node/Python/浏览器/Electron 共用 DAP 基础层，Node/浏览器/Electron 复用 js-debug 多目标会话，LLDB/Delve/NetCoreDbg 外部 Provider 通过受管 stdio/TCP 进程接入                                                                                                                     |

## IDE 运行与调试追加目标

| 目标域             | 判定                                         | 当前证据或缺口                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目识别与运行配置 | 已证明                                       | Node、前端、Electron、Java/Spring、Python、C/C++、.NET 和自定义建议生成有 18 项检测测试；常见 Vite、Next.js、CRA、Vue CLI 与 Electron 开发配置可建议端口；另有 4 项 Python 解释器发现测试和 3 项严格 locale IPC 合同测试，配置可编辑、持久化         |
| 项目运行           | 已证明                                       | 真实进程启动、输出、停止、重启、退出码、端口冲突和重复服务保护有集成/E2E                                                                                                                                                                             |
| 调试架构           | 已证明可扩展边界                             | DAP Client、Registry、独立 Node/Python/浏览器/Electron/Java Adapter、外部 LLDB/Delve/NetCoreDbg Adapter 和调试会话服务；Node attach、浏览器、Electron、Java 与三条外部路径的真实子进程握手、事件与清理已有集成或显式验收测试                         |
| 断点               | 已证明 Node/Python/浏览器/Electron/Java 闭环 | 行断点、条件、命中次数、日志点、异常规则、验证状态和持久化有真实 Adapter 测试/E2E；真实 Chrome、Electron 主/渲染进程和 Windows Maven/Java 均已命中源码行断点                                                                                         |
| 调试控制           | 已证明 Node/Python/浏览器/Java 闭环          | Continue、Pause、Step Over/Into/Out、Run to Cursor、Restart、Stop 有真实 DAP 验证；真实 Chrome 与 Java 均已验证 Continue 和单步                                                                                                                      |
| 调试信息面板       | 已证明核心闭环                               | 线程、栈帧、作用域、嵌套变量、监视表达式和断点列表进入真实 E2E                                                                                                                                                                                       |
| 调试控制台         | 已证明核心闭环                               | 求值、程序输出、异常与脱敏进入真实 Adapter/E2E；搜索/复制等细粒度 UI 仍主要靠实现检查                                                                                                                                                                |
| 异常定位           | 已证明 Node/Python/Java 闭环                 | 捕获真实异常、文件/行定位、当前执行行和脱敏上下文有集成/E2E；Java 还验证了忽略指定异常后在后续异常暂停                                                                                                                                               |
| AI 辅助调试        | 已证明 Node 闭环                             | `debug-ai-repair.spec.ts` 覆盖真实异常、脱敏预览、AI Diff、用户批准和显式重新调试                                                                                                                                                                    |
| 项目任务/组合运行  | 已证明                                       | 依赖任务、前后钩子、超时、组合服务、批量批准和失败联动有集成/E2E                                                                                                                                                                                     |
| 语言范围           | 本地语言闭环已证明；跨环境路线部分完成       | Node.js/TypeScript、Python、浏览器前端、Electron 主/渲染进程、Java、C/C++/Rust、Go、.NET 均完成 Windows 真实调试验收；Java 还在 macOS ARM64/Linux x64 公共 runner 通过；Node Inspector 远程/容器附加已验证，其他语言跨环境附加和自动隧道仍是后续范围 |

## 交付物审计

| 交付物                         | 判定                         | 位置或缺口                                                                                                                                             |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 完整源代码                     | 已提交并推送                 | 产品提交 `07ac062` 已进入 `release/0.7.0-alpha.1`，并取得 run `31247288230` 的公共三平台产品步骤证据                                                   |
| Windows 安装包                 | 已证明当前本地候选           | 产品提交 `07ac062` 的独立证据目录及 SHA-256；当前 CI artifact 上传失败                                                                                 |
| Linux x64 AppImage             | 当前提交已构建，制品缺失     | run `31247288230` 的原生构建与已打包 E2E 通过，但 artifact 上传失败；历史候选 artifact 不等同当前二进制                                                |
| macOS/Linux 构建配置           | 当前提交原生 CI 产品步骤通过 | `apps/desktop/electron-builder.yml`、目标运行时校验器、原生 CI 与签名发布 matrix；当前 DMG/ZIP/AppImage 仍需释放 artifact 配额后重新上传并下载核验     |
| README/安装/使用/排障/隐私说明 | 存在                         | `README.md`、`docs/installation.md`、`docs/user-guide.md`、`docs/troubleshooting.md`、`docs/privacy.md`                                                |
| 干净设备独立验收清单           | 存在；执行证据仍缺           | `docs/clean-device-acceptance.md` 覆盖三平台生命周期、22 步 AI 编程、IDE 调试修复、10 个 Provider、安全检查、证据记录与双人签字要求                    |
| 模型/Provider/Tool 开发说明    | 存在                         | `docs/model-configuration.md`、`docs/provider-development.md`、`docs/tool-development.md`                                                              |
| 架构/数据库/安全设计           | 存在                         | `docs/architecture.md` 包含数据库设计，`docs/security.md` 包含安全设计                                                                                 |
| 测试与供应链报告               | 存在                         | 本报告、[发布就绪报告](./release-readiness-2026-08-02.md)、[性能报告](./performance-2026-08-02.md)、CycloneDX SBOM、依赖/许可证审计与 Secret 扫描 JSON |
| 已知问题与路线图               | 存在                         | README 当前限制、发布就绪缺口表、`docs/roadmap.md`                                                                                                     |

## 最终 DoD 逐项判定

| DoD                                    | 判定                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| 核心业务闭环全部可运行、功能为真实实现 | 当前产品提交三平台自动化产品步骤支持；独立人工验收尚缺                 |
| 用户可配置/切换模型，API Key 安全保存  | 三平台本地/原生 runner 自动化闭环已证明                                |
| 文件受权限控制且修改可审核/回滚        | 已证明                                                                 |
| 命令可授权、终止和持久化               | 已证明                                                                 |
| 会话与任务可持久化                     | 已证明                                                                 |
| 核心自动化、类型、Lint、构建通过       | 已证明当前产品提交；公共三平台产品步骤通过，但 artifact 上传失败       |
| Windows 安装包正常安装运行             | 已证明未签名候选                                                       |
| 项目文档完整                           | 主要交付文档齐全                                                       |
| 无阻塞严重缺陷/已知高危安全问题        | High/Critical 依赖审计为 0；正式签名、当前制品与人工验收前不能最终确认 |
| 验收人员独立完成完整 AI 编程与调试任务 | 自动化 E2E 已覆盖；独立人工验收记录缺失                                |

因此，本审计保持目标为“进行中”。必须先完成当前三平台 artifact 上传与下载核验、Windows/macOS 正式签名及 notarization、10 个 Provider 真实公网验收和独立人员干净设备完整闭环，才能重新执行完成审计。
