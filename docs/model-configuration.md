# 模型配置指南

## 支持的接入方式

应用内置 OpenAI、Anthropic Claude、Google Gemini、OpenRouter、DeepSeek、通义千问、智谱 GLM、Moonshot/Kimi、Ollama 和 OpenAI Compatible Adapter。厂商差异封装在独立 Provider 中，Agent、权限、Diff 和会话流程不按厂商分支。

## 配置字段

- 服务商名称：仅用于本机显示。
- Provider 类型：决定协议转换和错误映射。
- Base URL：服务 API 根地址；远程服务要求 HTTPS，本机回环服务可明确使用 HTTP。
- API Key：由最终用户填写并交给操作系统安全存储；保存后不会回显。
- Model ID：实际请求使用的模型标识。
- 默认模型、快速模型、高级推理模型：工作台的用途分组。
- 最大上下文长度：用于上下文裁剪和预算估算。
- 工具调用、图片、流式响应、推理和结构化输出：可由已知模型自动识别，也可按服务实际能力覆盖。
- 自定义 Header：普通 Header 保存为非敏感配置；名称或用户标记为敏感的 Header 值进入 SecretStore。

URL 不得包含用户名或密码。应用拒绝危险重定向、不安全的传输 Header 和远程明文 HTTP。

## 新增并测试配置

1. 打开“模型设置”。
2. 选择预置 Provider；私有网关或兼容服务选择 OpenAI Compatible。
3. 填写名称、Base URL、API Key 和默认 Model ID。
4. 按服务文档设置能力、上下文长度和自定义 Header。
5. 点击“测试连接”。
6. 测试成功后拉取模型列表或保留手动 Model ID，保存配置。
7. 回到工作台，在模型选择器中选择该模型。

## 常见连接错误

- 认证失败：Key 无效、过期、Header 名称不匹配或账号无权限；更新密钥后重试。
- 模型不存在：Model ID 不属于该 Base URL；刷新模型列表或更正标识。
- 请求超时/服务不可用：检查网络、代理、服务地址和本机 Ollama 状态。
- 请求频率受限：等待服务商重试窗口，或切换模型/Provider。
- 上下文过长：移除上下文项、启用摘要或改用更大上下文模型。
- 工具/图片不支持：关闭错误声明的能力，或选择支持该能力的模型。

公开错误、审计日志和崩溃报告会脱敏。若远端错误正文包含请求内容，也只保留有界、脱敏后的可操作信息。

## 真实服务验收（发布前可选门禁）

仓库提供默认禁用的真实 Provider 验收。它会先调用所选 Provider 的连接检查/模型列表，再发送一条最多 32 token 的流式请求；单个 Provider 最长运行 60 秒。测试只断言事件类型和是否收到内容，不输出模型回复、API Key 或自定义 Header 值，失败消息也会再次执行凭据脱敏。真实请求可能产生少量服务费用。

先设置 `OPEN_CODE_DESK_PROVIDER_ACCEPTANCE`，值为 `all`，或以下一个/多个逗号分隔的 Provider 类型：

`openai-compatible`、`openai`、`anthropic`、`gemini`、`openrouter`、`deepseek`、`qwen`、`glm`、`moonshot`、`ollama`。

每个被选中的 Provider 使用以下临时进程环境变量，其中 `<SUFFIX>` 对应大写类型名；`openai-compatible` 使用 `OPENAI_COMPATIBLE`：

- `OPEN_CODE_DESK_PROVIDER_<SUFFIX>_BASE_URL`：与应用模型设置中相同的 API 根地址。
- `OPEN_CODE_DESK_PROVIDER_<SUFFIX>_MODEL`：用于最小流式请求的 Model ID。
- `OPEN_CODE_DESK_PROVIDER_<SUFFIX>_API_KEY`：除 `openai-compatible` 和 `ollama` 外必填。
- `OPEN_CODE_DESK_PROVIDER_<SUFFIX>_HEADERS_JSON`：可选的 JSON 字符串请求头；所有值均按敏感数据处理。

PowerShell 单 Provider 示例：

```powershell
$env:OPEN_CODE_DESK_PROVIDER_ACCEPTANCE='openai'
$env:OPEN_CODE_DESK_PROVIDER_OPENAI_BASE_URL='<provider-base-url>'
$env:OPEN_CODE_DESK_PROVIDER_OPENAI_MODEL='<provider-model-id>'
$env:OPEN_CODE_DESK_PROVIDER_OPENAI_API_KEY='<temporary-acceptance-key>'
pnpm test:providers:live
```

不要把这些值写入 `.env`、脚本、测试快照或 Git。运行后关闭该终端，或删除相应进程环境变量。专用脚本未设置选择器时会失败退出；普通 `pnpm test` 只报告这些真实网络门禁为跳过，不能把默认跳过结果视为公网验收成功。
