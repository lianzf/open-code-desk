# Provider 开发指南

Provider Adapter 只负责模型协议、能力和错误转换，不负责会话、Agent、工具权限、文件写入或 UI 状态。

## 契约

实现 [`ModelProvider`](../packages/provider-core/src/index.ts)：

```ts
interface ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
  validateConfig(config: ProviderConfig, context: ProviderContext): Promise<ValidationResult>;
  listModels(config: ProviderConfig, context: ProviderContext): Promise<ReadonlyArray<ModelInfo>>;
  streamChat(
    config: ProviderConfig,
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent>;
  getCapabilities(config: ProviderConfig, model: string): Promise<ModelCapabilities>;
}
```

`ProviderContext` 提供已解密但不持久化的 API Key、自定义 Header、取消信号和请求 ID。Adapter 不得把这些值写入日志、数据库或错误消息。

## 增加 Provider

1. 在 `apps/desktop/src/main/providers/<kind>/` 建立独立 Adapter 和协议转换文件。
2. 在 `packages/provider-core/src/index.ts` 增加稳定的 `ProviderKind`；不要在 Agent 主流程增加厂商判断。
3. 实现配置验证、模型列表、流式消息/工具事件转换和能力策略。
4. 在 `register-model-providers.ts` 注册 Adapter，并在模型设置表单加入配置选项。
5. 使用本地 HTTP/SSE fixture 编写协议测试，覆盖取消、超时、认证、模型不存在、限流、上下文过长、畸形响应和 Secret 脱敏。

## 实现要求

- 所有远端输入均视为不可信；限制状态码、Header、正文大小、事件大小和累计输出。
- 遵守 `AbortSignal`，在取消或超时后关闭读取流。
- 把厂商响应统一映射为 `ChatStreamEvent`，不要把原始协议泄漏给 Agent。
- 工具调用参数保持为字符串增量，最终由 Tool 的 Zod Schema 验证。
- 能力自动识别必须允许用户配置回退；未知模型不能凭名称宣称不存在的能力。
- 远程地址使用 HTTPS；只对明确的回环地址允许本机 HTTP。
- 错误必须说明发生了什么、是否可重试和用户下一步，同时移除凭据与有界化正文。

## 验证清单

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/provider-chat.spec.ts
```

至少证明连接测试、模型列表、文本流、停止生成、工具调用闭环、错误映射、配置持久化和重启恢复。需要真实厂商凭据的冒烟测试只能从 CI Secret 注入，不能成为默认测试的前置条件。
