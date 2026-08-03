# Tool 开发指南

模型请求的 Tool 名称和参数都属于不可信输入。Tool 必须通过统一注册表、Schema、权限策略、审批和审计执行，不能从 Renderer 或 Provider 直接调用系统能力。

## 契约

实现 [`AgentTool`](../packages/tool-core/src/index.ts)：

```ts
interface AgentTool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly permissionLevel: 'read' | 'write' | 'execute' | 'dangerous';
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
```

`ToolDispatcher` 在执行前查找唯一名称、用 Zod 验证参数、计算权限决策并等待审批；执行开始和结果由 Observer 写入审计/任务记录。取消信号必须传到底层文件、搜索、网络或进程操作。

## 增加 Tool

1. 在 `apps/desktop/src/main/tools/` 创建职责单一的实现。
2. 为所有字段定义有界 Zod Schema；拒绝未知字段、绝对路径逃逸、超长字符串和无界数组。
3. 设置最小权限等级：纯工作区读取为 `read`，文件副作用为 `write`，启动进程为 `execute`，不应自动执行的能力为 `dangerous`。
4. 在 `createReadOnlyToolRegistry` 或 `createAgentToolRegistry` 注册；不要修改 Agent 会话主流程。
5. 编写单元/集成测试，覆盖有效输入、畸形输入、权限拒绝、用户取消、底层失败、输出限制和审计记录。

## 文件 Tool

路径先由工作区服务规范化并验证真实路径/父目录，防止 `..`、符号链接或 junction 逃逸。敏感文件策略在 Tool 之外仍必须生效。写入 Tool 只能创建 FileChange 提案；未经 Diff 审批不得直接写盘。

## 命令 Tool

使用结构化 executable 与 args，保持 `shell: false`。审批摘要必须绑定完整输入，批准后参数变化会使批准失效。提权、广泛删除、系统目录、凭据读取、编码脚本和下载后执行应拒绝或单独确认。输出必须限长、可取消并脱敏环境变量中的 Secret。

## 结果与错误

返回可序列化、有界的结构。错误应使用稳定代码，说明失败原因、是否可重试和建议动作；不要把本机绝对敏感路径、环境变量、凭据或无限制命令输出交给模型。

## 验证清单

```bash
pnpm typecheck
pnpm test
pnpm build
```

若 Tool 参与核心用户流程，还要增加 Electron E2E，证明 Renderer 只显示审批和结果，执行仍发生在受信任主进程。
