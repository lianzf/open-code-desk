import type { CommandExecution } from '@open-code-desk/ipc-contracts';
import { Ban, Check, CircleStop, ShieldAlert, TerminalSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCommandStore } from './command.store';

const statusLabels: Readonly<Record<CommandExecution['status'], string>> = {
  pending_approval: '等待批准',
  approved: '已批准',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  cancelled: '已取消',
  timed_out: '已超时',
};

function commandLabel(command: CommandExecution): string {
  return [command.executable, ...command.args.map((argument) => JSON.stringify(argument))].join(
    ' ',
  );
}

function riskClass(command: CommandExecution): string {
  if (command.riskLevel === 'blocked' || command.riskLevel === 'high') {
    return 'border-red-900/70 bg-red-950/30 text-red-300';
  }
  if (command.riskLevel === 'medium') {
    return 'border-amber-900/70 bg-amber-950/30 text-amber-300';
  }
  return 'border-zinc-700 bg-zinc-900 text-zinc-400';
}

function CommandCard({ command }: { readonly command: CommandExecution }) {
  const [remember, setRemember] = useState(false);
  const decide = useCommandStore((state) => state.decide);
  const cancel = useCommandStore((state) => state.cancel);
  const busy = useCommandStore((state) => state.busyCommandId === command.id);

  return (
    <article
      className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2"
      data-testid={`command-${command.status}`}
    >
      <div className="flex items-center gap-2">
        <TerminalSquare className="size-3.5 text-cyan-500" />
        <span className="text-[11px] font-medium text-zinc-300">{command.toolName}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] ${riskClass(command)}`}>
          {command.riskLevel.toUpperCase()}
        </span>
        <span className="ml-auto text-[10px] text-zinc-500">{statusLabels[command.status]}</span>
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] leading-4 text-zinc-300">
        {commandLabel(command)}
      </pre>
      <dl className="mt-2 grid grid-cols-[48px_1fr] gap-x-2 gap-y-1 text-[10px] text-zinc-500">
        <dt>目录</dt>
        <dd className="min-w-0 break-all text-zinc-400">{command.cwd}</dd>
        <dt>超时</dt>
        <dd className="text-zinc-400">{Math.round(command.timeoutMs / 1_000)} 秒</dd>
      </dl>
      <ul className="mt-2 space-y-1 text-[10px] text-zinc-500">
        {command.riskReasons.map((reason) => (
          <li key={reason} className="flex gap-1.5">
            <ShieldAlert className="mt-0.5 size-3 shrink-0" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      {command.outputTail !== '' ? (
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black p-2 font-mono text-[10px] leading-4 text-zinc-400">
          {command.outputTail}
        </pre>
      ) : null}
      {command.exitCode !== undefined ? (
        <p className="mt-1 text-[10px] text-zinc-500">退出码：{command.exitCode}</p>
      ) : null}
      {command.error !== undefined ? (
        <p className="mt-2 rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">
          {command.error.message}
        </p>
      ) : null}
      {command.status === 'pending_approval' ? (
        <div className="mt-2 space-y-2">
          {command.riskLevel !== 'high' && command.riskLevel !== 'blocked' ? (
            <label className="flex items-center gap-2 text-[10px] text-zinc-500">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              {remember ? '记住此可执行文件与目录的决定' : '仅批准本次执行'}
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void decide(command.id, 'reject', remember)}
              data-testid="reject-command"
            >
              <Ban className="size-3.5" />
              拒绝
            </Button>
            <Button
              size="sm"
              disabled={busy || command.riskLevel === 'blocked'}
              onClick={() => void decide(command.id, 'approve', remember)}
              data-testid="approve-command"
            >
              <Check className="size-3.5" />
              批准并执行
            </Button>
          </div>
        </div>
      ) : command.status === 'running' || command.status === 'approved' ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void cancel(command.id)}
            data-testid="cancel-command"
          >
            <CircleStop className="size-3.5" />
            终止命令
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function CommandReviewPanel() {
  const commands = useCommandStore((state) => state.commands);
  const rules = useCommandStore((state) => state.rules);
  const errorMessage = useCommandStore((state) => state.errorMessage);
  const setNetworkAccess = useCommandStore((state) => state.setNetworkAccess);
  const deleteRule = useCommandStore((state) => state.deleteRule);
  const networkAllowed = rules.some((rule) => rule.kind === 'allow_network_commands');

  if (commands.length === 0 && rules.length === 0 && errorMessage === undefined) {
    return null;
  }

  const pending = commands.filter((command) =>
    ['pending_approval', 'approved', 'running'].includes(command.status),
  );
  const history = commands.filter(
    (command) => !['pending_approval', 'approved', 'running'].includes(command.status),
  );

  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
        <TerminalSquare className="size-3.5" />
        Agent 命令（{commands.length}）
      </div>
      {errorMessage === undefined ? null : (
        <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">
          {errorMessage}
        </p>
      )}
      {pending.map((command) => (
        <CommandCard key={command.id} command={command} />
      ))}
      {history.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[10px] text-zinc-500">
            历史命令（{history.length}）
          </summary>
          <div className="mt-2 space-y-2">
            {history.slice(0, 20).map((command) => (
              <CommandCard key={command.id} command={command} />
            ))}
          </div>
        </details>
      ) : null}
      <details>
        <summary className="cursor-pointer text-[10px] text-zinc-500">命令权限规则</summary>
        <div className="mt-2 space-y-2">
          <label className="flex items-center justify-between gap-3 text-[10px] text-zinc-400">
            允许白名单网络命令自动执行
            <input
              type="checkbox"
              checked={networkAllowed}
              onChange={(event) => void setNetworkAccess(event.target.checked)}
            />
          </label>
          {rules
            .filter((rule) => rule.kind !== 'allow_network_commands')
            .map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-[10px]"
              >
                <span
                  className={rule.kind === 'deny_executable' ? 'text-red-400' : 'text-cyan-400'}
                >
                  {rule.kind === 'deny_executable' ? '拒绝' : '允许'}
                </span>
                <code className="min-w-0 flex-1 truncate text-zinc-500">{rule.value}</code>
                <button
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300"
                  onClick={() => void deleteRule(rule.id)}
                  aria-label="删除命令规则"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
        </div>
      </details>
    </section>
  );
}
