# 0.7.0-alpha.1 发布就绪审计

日期：2026-08-02（当前候选公共三平台 CI 与本机 Windows 复验：2026-08-08）
审计对象：本地 `release/0.7.0-alpha.1` 工作树  
结论：核心产品闭环与本地质量门禁已通过；当前候选的三平台公共 CI 产品步骤均通过，但 artifact 上传因 GitHub 存储配额失败，且正式签名、真实 Provider 与独立设备验收仍缺失，不能标记为正式版完成。

## 已验证能力

- 10 个计划内 Provider 已注册：OpenAI Compatible、OpenAI、Anthropic、Gemini、OpenRouter、DeepSeek、Qwen、GLM、Moonshot/Kimi 和 Ollama；模型能力解析具有自动识别与用户配置回退。
- 项目规则文件、图片上下文、任务恢复、失败步骤重试、权限审批、审计日志、自动更新、本地崩溃报告、主题、快捷键和核心界面双语切换均有真实实现。
- Node.js/TypeScript、Python、浏览器前端与 Electron 主/渲染进程使用随包真实 DAP；React、Vue、Next.js 端口型配置可编排经审批的开发服务器和本机 Chrome/Edge，Electron 以同一 js-debug 服务管理 `pwa-node` 与 `pwa-chrome` 双客户端。Windows 已完成 Chrome、Electron、Java/JDT LS、C/C++/Rust LLVM/LLDB、Go/Delve 和 .NET/NetCoreDbg 的真实断点、变量与清理验收，适用路径还验证了单步。项目任务、组合运行、端口冲突处理、高级断点、异常规则、调试上下文与 AI Diff 审核形成持久化闭环。
- Windows、macOS 和 Linux 均有 electron-builder 目标；CI 使用对应原生 runner 构建 NSIS、DMG/ZIP 和 AppImage，并上传 SHA-256 摘要。
- `2da293f6b888a54bc96778b8da78e6e8e1b70b13` 的 CI run `30933901524` 已在 Windows x64、macOS ARM64、Linux x64 完成真实 Java 调试、安装包构建、运行时完整性和已打包应用 E2E，四个 job 全部成功。
- 命令允许规则精确绑定可执行文件、工作目录和完整参数；历史宽泛允许规则升级后失效，拒绝规则仍可宽泛阻断。
- Provider JSON/SSE 响应按原始字节流执行限额，并在响应头之后继续执行正文停滞与总体时长限制；当前工作区服务不再把历史工作区 ID 当作磁盘访问授权。

## 本地门禁记录

| 检查                             | 结果                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `pnpm format:check`              | 通过                                                  |
| `pnpm docs:check`                | 12 必需文档 / 50 链接通过                             |
| `pnpm lint`                      | 通过                                                  |
| `pnpm typecheck`                 | 通过                                                  |
| `pnpm test`                      | 112 文件 / 393 测试通过；7 个门禁文件 / 18 项默认跳过 |
| `pnpm test:integration`          | 29 文件 / 94 测试通过                                 |
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
| 下载候选 Windows 隔离安装烟测    | 安装/卸载退出码 0；冷启动 3.06 秒；残留进程 0         |
| 下载候选 Windows 已安装核心 E2E  | 9 / 9 通过；安装目录、用户数据和进程均无残留          |
| `pnpm security:dependency-audit` | 710 项 / 全部严重级别 0                               |
| `pnpm security:secrets`          | 559 文件 / 0 未允许发现                               |
| `pnpm security:licenses`         | 149 组件 / 0 待复核                                   |
| CycloneDX 1.6 SBOM               | 588 组件 / Schema 通过                                |
| 桌面打包生产依赖                 | 15 / 15 可解析                                        |
| Windows 打包运行时完整性         | 通过                                                  |
| Linux x64 AppImage/运行时完整性  | 通过                                                  |
| Linux 已打包应用核心 E2E         | 9 / 9 通过                                            |
| Linux GNOME Secret Service       | 写入、读取、清除通过                                  |
| `git diff --check`               | 通过                                                  |

10,000 文件基准的完整指标见[性能验收报告](performance-2026-08-02.md)。

## 当前候选产物证据

CI run `30933901524` 的四个 artifact 已下载到独立证据目录
`D:\release-evidence\open-code-desk-ci-30933901524`。GitHub artifact 摘要对应服务端归档，
下表 SHA-256 对应解压后的实际安装/分发文件；二者不混用。

| Artifact                     | ID           | 归档字节    | GitHub 归档摘要                                                    | 到期时间（UTC）     |
| ---------------------------- | ------------ | ----------- | ------------------------------------------------------------------ | ------------------- |
| `open-code-desk-windows-x64` | `8902708321` | 181,560,324 | `691716f7da402951f28fb3ea82e0f8ccc1b6159afcf20f8d5121cc8f7ca42020` | 2026-08-18 17:40:15 |
| `open-code-desk-macos-arm64` | `8902565841` | 409,111,035 | `1995ee77bbb976c344f8c5b939b2a2cbc7841d0c6d851b1d3197bafe0f00161b` | 2026-08-18 17:35:42 |
| `open-code-desk-linux-x64`   | `8902573519` | 212,643,341 | `62efa5592498fc35cc086096ad048317167668f40bef526c87ac3e25173183f1` | 2026-08-18 17:36:01 |
| `quality-security-metadata`  | `8902424531` | 35,208      | `13a5927cfd5427b0b5f827388ac17720b9c98a149734eaacd3677a0b8294137f` | 2026-08-18 17:31:30 |

| 分发文件                                    | 字节        | 重算 SHA-256                                                       | 清单比对 |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------ | -------- |
| `OpenCode Desk Setup 0.7.0-alpha.1.exe`     | 181,391,882 | `C86654663A807DAB2D7543A588A1009773E1857E56A12B7F6664F3755A64AA59` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1.AppImage`      | 213,150,044 | `8D6E63BD929052DFE2BC8CD76E83853569D7060EA31CAEE37086CEEA3D628469` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1-arm64.dmg`     | 204,605,117 | `8CB6F2BB21A1FC6B6849D46DCC80313F307B17BAB3F901E46332C3270E552CAD` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1-arm64-mac.zip` | 204,948,045 | `5D01A82EADC5B684D956711370374E749448F8BCDF8FF46875531964919F2E29` | 一致     |

三平台 `SHA256SUMS.txt` 共列出 19 个文件；本机逐项重算后缺失、额外、重复和摘要不一致均为 0。
依赖报告为 710 项且全部严重级别为 0，许可证报告为 149 个随包组件且待复核为 0，Secret 扫描为
557 个源码文件且未允许发现为 0。CycloneDX 1.6 SBOM 组件数分别为 Windows 588、macOS 589、
Linux 587。Windows 安装包版本元数据为 `0.7.0-alpha.1`，Authenticode 状态为 `NotSigned`。

### 后续成功候选（run 30944352985）

提交 `7c144596396f4426497b97440c978f8a66a182f6` 的 CI run `30944352985` 在 attempt 1 的 Windows 已安装应用 E2E 失败后保留原始失败记录，attempt 2 重新执行 Windows job 并成功；最终 Quality gates、Windows x64、macOS ARM64 和 Linux x64 四个 job 均成功。四个发布/质量 artifact 已下载到独立目录 `D:\release-evidence\open-code-desk-ci-30944352985`：

| Artifact                     | ID           | 归档字节    | GitHub 归档摘要                                                    | 到期时间（UTC）     |
| ---------------------------- | ------------ | ----------- | ------------------------------------------------------------------ | ------------------- |
| `open-code-desk-windows-x64` | `8912946359` | 181,560,373 | `b780a3a4dfd64e86f0f66dc150924038afc49f6078122dcfd0c8b75cb5811a94` | 2026-08-18 23:46:00 |
| `open-code-desk-macos-arm64` | `8906664876` | 409,110,915 | `2338f10447e8f1834e1989aaca30fcdb0fb3aa4a1217cf952acaabec31985850` | 2026-08-18 19:47:58 |
| `open-code-desk-linux-x64`   | `8906713192` | 212,643,343 | `18eae74197f7cf98790ea8af7ecc71b3d3b3cf912c0e2e36b3a48dc3fffe9612` | 2026-08-18 19:49:38 |
| `quality-security-metadata`  | `8906575235` | 35,208      | `36c6add42da3db1407bd846dafadf46a8afc098b61563fa476cfccd7f60edbe6` | 2026-08-18 19:45:12 |

| 分发文件                                    | 字节        | 重算 SHA-256                                                       | 清单比对 |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------ | -------- |
| `OpenCode Desk Setup 0.7.0-alpha.1.exe`     | 181,391,882 | `A221009D36C0CACE15A87E0979264E5E5DC1DE6CD69894FAEF793C4D796C27D7` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1.AppImage`      | 213,150,046 | `D374ABA918D6902B3228A9DA34B9DDD9558CD1687F66D5FC2AE9298F78E5E3FB` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1-arm64.dmg`     | 204,605,025 | `E1A8EB590F5BE6DE62D63B952A1795AAA067A8DA14BB1B8DB676C39CB980A2DA` | 一致     |
| `OpenCode Desk-0.7.0-alpha.1-arm64-mac.zip` | 204,948,045 | `32DB10C70789182A005D6A6D466C88B84237731B9B1465C12DA89545E1B4552F` | 一致     |

三平台清单共 19 项，逐项重算后的缺失、额外、重复与摘要不一致均为 0；依赖漏洞严重级别均为 0，149 个随包组件均无需许可证复核，Secret 扫描覆盖 559 个源码文件且发现为 0，SBOM 组件数为 Windows 588、macOS 589、Linux 587。Windows Authenticode 仍为 `NotSigned`。该 run 与 `30933901524` 的分发文件大小接近但哈希均不同，不能声称二进制等价；`7c14459` 到当前产品代码 `0a2d35f` 还增加了 E2E 状态观测属性，而 `4689a2a` 只修改 CI 行为，因此该组证据仍不替代当前提交的精确 artifact。

### 当前候选的本机精确 Windows 证据（提交 03b5ac3）

2026-08-08 对提交 `03b5ac3bfdfebf9edbc7c0b20015cc023ba2b0a7` 的产品树执行完整本地门禁和全新 Windows x64 打包。该提交固定 `js-yaml` 4.3.1 与 `nanoid` 3.3.17，使当日新增的两个 High advisory 清零；同时让强制进程树终止等待被终止子进程实际退出。调试会话清理集成测试连续 10 轮通过，随后完整门禁的 112 个单测文件 / 393 项测试、29 个集成文件 / 94 项测试和桌面端 E2E 16/16 均通过。

全新 `release` 目录只生成一个 0.7 NSIS。安装包及其六项清单文件已复制到 `D:\release-evidence\open-code-desk-local-03b5ac3bfdfebf9edbc7c0b20015cc023ba2b0a7-windows-x64`；`SHA256SUMS.txt` 6/6 逐项重算一致。安装包为 183,398,515 字节，SHA-256 为 `CBA1282143A8C2309D073BD63A07C8A962DED1ADE2C2FC142357BC7C41327FC6`，Authenticode 为 `NotSigned`。隔离静默安装与卸载退出码均为 0，冷启动 3.06 秒，窗口标题正确，无需强杀，残留产品进程为 0；随后已安装应用核心 E2E 9/9 通过，清理后安装 E2E 目录、烟测目录和产品进程均为 0。该证据精确覆盖当前候选的 Windows 产品树，但不能替代原生 macOS/Linux CI artifact、正式签名/notarization 或独立人工设备验收。

## 正式发布门槛判定

| 门槛                              | 当前证据                                                                                                                                                                                                                                                                                                                                                                                                                                            | 判定                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 连续运行 4 小时无明显内存泄漏     | 隔离、自报告的 v12 于 2026-08-03 09:41:39–13:42:09 完成：240 分钟、20 个会话、13,643 次 soak 迭代、242 个内存样本；Heap 35.84→24.44 MiB（增长 -11.40 MiB，门槛 +256 MiB），RSS 228.87→57.17 MiB（增长 -171.70 MiB，门槛 +512 MiB）；24 个验收心跳、480 个原生心跳；页面错误、Renderer 崩溃、窗口无响应、`render-process-gone`、失败标记和 stderr 均为 0；自报告退出码 0，`1 passed (4.0h)`，相关残留进程 0；证据为 `.runtime/stability-final-v12.*` | 满足（Windows 4 小时基线）                                                             |
| 当前源码对应的 Windows 安装包     | 提交 `03b5ac3` 的本机全新 NSIS 为 183,398,515 字节，SHA-256 `CBA1282143A8C2309D073BD63A07C8A962DED1ADE2C2FC142357BC7C41327FC6`，清单 6/6 一致，Authenticode 为 `NotSigned`；安装/卸载、3.06 秒冷启动、零残留与已安装核心 E2E 9/9 均通过。CI run `31244154662` 的 Windows job `93070391329` 也完成构建、安装烟测和已安装 E2E，仅最终 artifact 上传因配额失败。                                                                                       | 当前产品树的本机未签名候选与公共 Windows 自动化通过；缺少可下载的当前 CI artifact      |
| Windows 正式签名                  | 现有 0.7 NSIS 的 Authenticode 状态为 `NotSigned`；`Cert:\CurrentUser\My -CodeSigningCert` 计数为 0，`CSC_LINK`/`CSC_KEY_PASSWORD` 均未配置；GitHub Environments 查询总数为 0，工作流引用的 `release-signing` 环境尚不存在                                                                                                                                                                                                                           | 未满足                                                                                 |
| macOS 正式签名与 notarization     | 配置包含 hardened runtime 和 DMG/ZIP 目标，但本机没有 macOS 原生环境；`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 均未配置；仓库也没有 `release-signing` Environment，因而没有本轮签名/notarization 与干净设备证据                                                                                                                  | 未满足                                                                                 |
| 当前源码对应的 Linux x64 AppImage | CI run `31244154662` 的 Linux job `93070391332` 在原生 runner 完成 JDK 21 Java 调试、AppImage 构建、运行时完整性和已打包应用 E2E；仅最终 artifact 上传因配额失败。                                                                                                                                                                                                                                                                                  | 满足“Linux 至少可构建”及当前产品树的公共原生自动化证据；缺少可下载的当前 artifact      |
| 当前源码对应的 macOS 产物         | CI run `31244154662` 的 macOS job `93070391327` 在 `macos-15` ARM64 完成真实 Java 调试、DMG/ZIP 构建、运行时完整性与已打包应用 E2E；仅最终 artifact 上传因配额失败。                                                                                                                                                                                                                                                                                | 当前产品树的原生自动化满足；缺少可下载 artifact，且未签名/notarize、无独立人工设备证据 |
| 全部计划 Provider 公网验收        | 2026-08-05 仅检查进程环境变量存在性：选择器及 10 个 Provider 的 Base URL、Model、API Key、自定义 Header 变量均不存在，未读取任何凭据值；本机也没有 Ollama 命令或 `127.0.0.1:11434` 服务。现有显式门禁会逐项验证连接/模型列表和最多 32 token 的流式响应，并限制为 60 秒、禁止输出回复正文、对凭据执行失败脱敏。默认跳过仅证明无意外网络访问，不能替代真实凭据后的公网运行证据                                                                        | 验收基础设施已具备；缺少用户提供的测试凭据与实际通过记录                               |
| 独立人工完整闭环                  | 自动化 E2E 覆盖核心 AI 编程与调试流程；现已提供 `docs/clean-device-acceptance.md`，逐项规定三平台生命周期、22 步 AI 编程、IDE 调试修复、10 个 Provider、安全检查和签字要求，但当前仍没有独立验收人员在干净 Windows/macOS/Linux 设备上的完整记录                                                                                                                                                                                                     | 执行清单已具备；缺少独立人员与干净设备证据                                             |
| 0.7 GitHub Release                | 远端最新 Release 为 0.6.0-alpha.1；旧候选的三平台 artifact 已保留，本轮精确候选的 artifact 因存储配额未能上传                                                                                                                                                                                                                                                                                                                                       | 未满足；当前 artifact、签名、notarization 与独立验收完成前不发布                       |
| 单个业务文件原则上不超过 400 行   | 排除测试、产物和 vendor 后，TypeScript/TSX 生产源码超过 400 行的文件为 0；主进程、Preload、IPC 合同、数据库、运行/调试/任务服务、Store 与工作台 UI 已按职责拆分                                                                                                                                                                                                                                                                                     | 满足                                                                                   |
| 完整双语动态诊断                  | 核心静态界面已双语化，Renderer 错误展示点统一经过本地化边界；应用自有的主进程/DAP 英文与中文诊断均受双向源码覆盖门禁约束，项目检测、Python 解释器说明、命令风险、工具批准原因和命令服务诊断有双语测试。第三方原始诊断按原文保留                                                                                                                                                                                                                     | 满足；产品自有诊断已完成双向覆盖，第三方技术细节按原文保留                             |
| 正式版逐步语言调试范围            | Node.js/TypeScript、Python、浏览器前端、Electron 主/渲染进程、Java、C/C++/Rust、Go、.NET 均已接入并完成 Windows 真实断点、栈、变量与清理验收；Java 还在 macOS ARM64/Linux x64 公共 runner 完成断点、变量、单步、异常与清理。Node Inspector 远程/容器附加已验证；其他语言跨环境附加和自动隧道尚未接入                                                                                                                                                | 本地语言范围与 Java 三平台自动化满足；跨环境路线部分完成                               |

## 远端证据边界

2026-08-04 使用当前 GitHub 身份重新只读查询：产品代码提交 `2da293f6b888a54bc96778b8da78e6e8e1b70b13` 已推送到远端 `release/0.7.0-alpha.1`；CI run `30933901524` 的 Quality gates、Windows x64、macOS ARM64、Linux x64 四个 job 均成功，并上传三平台产物与质量/安全元数据。失败/修复链保留如下：`cb7e6fd` 的 run `30921479075` 暴露 Python 单步后的旧暂停状态，`0b11ee0` 的 run `30922841285` 通过；`7986640` 的 run `30925247786` 暴露保存期间外部变化丢失，`533976e` 先加入保存后磁盘对账；`c8d8b2d` 的 run `30928566420` 暴露 Python 输出与暂停事件排序，`9366c95` 修正集成测试同步，但其 run `30929307635` 又证明 Linux `fs.watch` 可漏掉外部编辑；`495f16a` 增加活动编辑器磁盘对账后，run `30930799500` 的质量门禁通过，却在 Linux 已打包测试暴露重叠调试控制、在 Windows 暴露 Chromium 用户目录删除占用；`2da293f` 串行化调试控制并为测试目录清理增加受限重试，本机 Python 调试 10/10、AI 调试清理 5/5、完整 E2E 16/16，最终 run `30933901524` 四个平台 job 全部通过。最新 Release 仍为 `v0.6.0-alpha.1`，`v0.7.0-alpha.1` tag 不存在，仓库 Environment 与 Actions Secret 名称查询均为空。

2026-08-05 对 run `30933901524` 下载到 `D:\release-evidence\open-code-desk-ci-30933901524` 的 Windows NSIS 再次执行本机自动化：隔离静默安装、独立用户数据启动、正常关闭与静默卸载全部通过，冷启动 3.23 秒且残留进程为 0；随后同一安装包的 9 项已安装应用核心 E2E 全部通过，清理后没有残留安装目录、用户数据或产品进程。该证据仍属于开发者本机自动化，不替代正式签名或独立干净设备人工验收。

2026-08-05 对提交 `4689a2ab5d6152669afc803394b3294d4c5ae507` 的 CI run `30976168758` 执行失败任务重跑（attempt 2）。Quality gates 保持成功；Windows 安装器构建、安装烟测与已安装应用 E2E，macOS ARM64 的 Java 调试、安装包构建与已打包应用 E2E，以及 Linux x64 的 Java 调试、AppImage 构建与已打包应用 E2E 均成功。三个平台仅在最后的 `Upload installer` 失败，日志一致报告 GitHub Actions artifact 存储配额仍在后台重算，删除后的使用量需要 6–12 小时刷新；因此该轮未产生新 artifact，不能作为“当前提交安装包已上传”的证据。

2026-08-08 对同一 run 执行 attempt 3 时，GitHub 已进入当日新的依赖审计数据窗口：Windows job `93064543031`、macOS job `93064543047` 和 Linux job `93064543053` 均在 `Build installer` 内被两个新 High advisory 阻断，分别为 `js-yaml` `<4.3.1` 与 `nanoid` `<3.3.17`。当前候选提交 `03b5ac3` 将两者固定到 4.3.1 与 3.3.17，本机依赖审计随后恢复为 High 0 / Critical 0；没有把 attempt 3 当作配额或偶发失败重跑掩盖。

提交 `03b5ac3bfdfebf9edbc7c0b20015cc023ba2b0a7` 的新 CI run `31244154662` 中，Quality gates job `93069870961` 成功；Windows job `93070391329` 完成安装器构建、安装烟测与已安装应用 E2E，macOS job `93070391327` 完成原生 Java 调试、DMG/ZIP 构建与已打包应用 E2E，Linux job `93070391332` 完成原生 Java 调试、AppImage 构建与已打包应用 E2E。三个平台 job 均只在最终 `Upload installer` 失败，质量元数据上传也收到相同 annotation：`Artifact storage quota has been hit`。因此该 run 精确证明当前产品树的三平台构建与自动化通过，但最终结论仍为 failure，且没有产生可下载 artifact，不能声称当前候选 CI 全绿或制品齐备。

重跑前已按精确 ID 删除 96 个已被后续结果取代的旧 artifact，并保留 run `30933901524` 与 `30944352985` 的 9 个关键证据 artifact。删除后 API 复核为 9 个、共 1,606,718,604 字节，ID 为 `8902424531`、`8902565841`、`8902573519`、`8902708321`、`8906575235`、`8906664876`、`8906713192`、`8906833661`、`8912946359`。旧 artifact 删除不可直接恢复，但对应提交仍可重新运行生成；在 GitHub 后台计量刷新前不重复消耗 runner 重跑。

## 发布判定

当前可以作为三平台构建与自动化均已通过的 0.7 alpha 候选继续验收，不能标记为正式版完成。当前精确候选仍须在释放 GitHub artifact 配额后重跑并下载核验三平台制品；此外还须提供 Windows/macOS 正式签名与 notarization 输入、全部计划 Provider 的真实公网通过记录，以及独立验收人员在干净设备上的完整 AI 编程与调试闭环记录。
