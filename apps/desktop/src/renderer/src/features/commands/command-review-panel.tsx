import type { CommandExecution } from '@open-code-desk/ipc-contracts';
import { Ban, Check, CircleStop, Plus, ShieldAlert, TerminalSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { translateApproval } from '@/features/changes/approval-i18n';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { rendererRiskReason } from '@/features/settings/command-risk-i18n';
import { rendererErrorDetail } from '@/features/settings/error-i18n';
import { useCommandStore } from './command.store';

const statusLabels = {
  pending_approval: 'pendingApproval',
  approved: 'approved',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  rejected: 'rejected',
  cancelled: 'cancelled',
  timed_out: 'timedOut',
} as const;

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
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (
    key: Parameters<typeof translateApproval>[1],
    values?: Record<string, string | number>,
  ) => translateApproval(locale, key, values);

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
        <span className="ml-auto text-[10px] text-zinc-500">{t(statusLabels[command.status])}</span>
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] leading-4 text-zinc-300">
        {commandLabel(command)}
      </pre>
      <dl className="mt-2 grid grid-cols-[48px_1fr] gap-x-2 gap-y-1 text-[10px] text-zinc-500">
        <dt>{t('directory')}</dt>
        <dd className="min-w-0 break-all text-zinc-400">{command.cwd}</dd>
        <dt>{t('timeout')}</dt>
        <dd className="text-zinc-400">
          {t('seconds', { value: Math.round(command.timeoutMs / 1_000) })}
        </dd>
      </dl>
      <ul className="mt-2 space-y-1 text-[10px] text-zinc-500">
        {command.riskReasons.map((reason) => (
          <li key={reason} className="flex gap-1.5">
            <ShieldAlert className="mt-0.5 size-3 shrink-0" />
            <span>{rendererRiskReason(reason)}</span>
          </li>
        ))}
      </ul>
      {command.outputTail !== '' ? (
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black p-2 font-mono text-[10px] leading-4 text-zinc-400">
          {command.outputTail}
        </pre>
      ) : null}
      {command.exitCode !== undefined ? (
        <p className="mt-1 text-[10px] text-zinc-500">
          {t('exitCode', { value: command.exitCode })}
        </p>
      ) : null}
      {command.error !== undefined ? (
        <p className="mt-2 rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">
          {rendererErrorDetail(command.error.message, command.error.code, 'commandOperationFailed')}
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
              {remember ? t('rememberDecision') : t('approveOnce')}
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
              {t('reject')}
            </Button>
            <Button
              size="sm"
              disabled={busy || command.riskLevel === 'blocked'}
              onClick={() => void decide(command.id, 'approve', remember)}
              data-testid="approve-command"
            >
              <Check className="size-3.5" />
              {t('approveAndRun')}
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
            {t('stopCommand')}
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
  const setReadAutoAllow = useCommandStore((state) => state.setReadAutoAllow);
  const addExecutableRule = useCommandStore((state) => state.addExecutableRule);
  const addBlockedPath = useCommandStore((state) => state.addBlockedPath);
  const grantExternalDirectory = useCommandStore((state) => state.grantExternalDirectory);
  const deleteRule = useCommandStore((state) => state.deleteRule);
  const networkAllowed = rules.some((rule) => rule.kind === 'allow_network_commands');
  const readAutoAllowed = !rules.some((rule) => rule.kind === 'require_read_approval');
  const [ruleKind, setRuleKind] = useState<'allow_executable' | 'deny_executable'>(
    'allow_executable',
  );
  const [ruleExecutable, setRuleExecutable] = useState('');
  const [ruleCwd, setRuleCwd] = useState('');
  const [ruleArgs, setRuleArgs] = useState('');
  const [blockedPath, setBlockedPath] = useState('');
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (
    key: Parameters<typeof translateApproval>[1],
    values?: Record<string, string | number>,
  ) => translateApproval(locale, key, values);

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
        {t('agentCommands', { value: commands.length })}
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
            {t('commandHistory', { value: history.length })}
          </summary>
          <div className="mt-2 space-y-2">
            {history.slice(0, 20).map((command) => (
              <CommandCard key={command.id} command={command} />
            ))}
          </div>
        </details>
      ) : null}
      <details>
        <summary className="cursor-pointer text-[10px] text-zinc-500">
          {t('workspaceRules')}
        </summary>
        <div className="mt-2 space-y-2">
          <label className="flex items-center justify-between gap-3 text-[10px] text-zinc-400">
            {t('autoAllowRead')}
            <input
              type="checkbox"
              checked={readAutoAllowed}
              onChange={(event) => void setReadAutoAllow(event.target.checked)}
              data-testid="auto-allow-read-tools"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[10px] text-zinc-400">
            {t('autoAllowNetwork')}
            <input
              type="checkbox"
              checked={networkAllowed}
              onChange={(event) => void setNetworkAccess(event.target.checked)}
            />
          </label>
          <div className="grid grid-cols-[92px_1fr_1fr_1fr_auto] gap-1">
            <select
              className="rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[10px] text-zinc-400"
              value={ruleKind}
              onChange={(event) =>
                setRuleKind(event.target.value as 'allow_executable' | 'deny_executable')
              }
              aria-label={t('commandRuleType')}
            >
              <option value="allow_executable">{t('allow')}</option>
              <option value="deny_executable">{t('reject')}</option>
            </select>
            <input
              className="h-7 min-w-0 rounded border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300 outline-none"
              value={ruleExecutable}
              onChange={(event) => setRuleExecutable(event.target.value)}
              placeholder={t('executablePlaceholder')}
              aria-label={t('ruleExecutable')}
            />
            <input
              className="h-7 min-w-0 rounded border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300 outline-none"
              value={ruleCwd}
              onChange={(event) => setRuleCwd(event.target.value)}
              placeholder={t('cwdPlaceholder')}
              aria-label={t('ruleCwd')}
            />
            <input
              className="h-7 min-w-0 rounded border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300 outline-none disabled:opacity-50"
              value={ruleArgs}
              onChange={(event) => setRuleArgs(event.target.value)}
              placeholder={t('argsPlaceholder')}
              aria-label={t('ruleArgs')}
              disabled={ruleKind === 'deny_executable'}
            />
            <button
              className="rounded border border-zinc-800 px-2 text-zinc-500 hover:bg-zinc-800 hover:text-cyan-300 disabled:opacity-40"
              disabled={ruleExecutable.trim() === ''}
              onClick={() => {
                const args = ruleArgs === '' ? [] : ruleArgs.split('\n');
                void addExecutableRule(ruleKind, ruleExecutable, ruleCwd, args).then(() => {
                  setRuleExecutable('');
                  setRuleArgs('');
                });
              }}
              aria-label={t('addCommandRule')}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {rules
            .filter((rule) => rule.kind === 'allow_executable' || rule.kind === 'deny_executable')
            .map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-[10px]"
              >
                <span
                  className={rule.kind === 'deny_executable' ? 'text-red-400' : 'text-cyan-400'}
                >
                  {rule.kind === 'deny_executable' ? t('reject') : t('allow')}
                </span>
                <code className="min-w-0 flex-1 truncate text-zinc-500">{rule.value}</code>
                <button
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300"
                  onClick={() => void deleteRule(rule.id)}
                  aria-label={t('deleteCommandRule')}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          <div className="border-t border-zinc-800 pt-2">
            <p className="text-[10px] text-zinc-500">{t('blockedPaths')}</p>
            <div className="mt-1 flex gap-1">
              <input
                className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300 outline-none"
                value={blockedPath}
                onChange={(event) => setBlockedPath(event.target.value)}
                placeholder={t('blockedPathPlaceholder')}
                aria-label={t('blockedRelativePath')}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={blockedPath.trim() === ''}
                onClick={() => {
                  void addBlockedPath(blockedPath).then(() => setBlockedPath(''));
                }}
              >
                {t('add')}
              </Button>
            </div>
            {rules
              .filter((rule) => rule.kind === 'blocked_path')
              .map((rule) => (
                <div
                  key={rule.id}
                  className="mt-1 flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-[10px]"
                >
                  <Ban className="size-3 text-red-400" />
                  <code className="min-w-0 flex-1 truncate text-zinc-500">{rule.value}</code>
                  <button
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300"
                    onClick={() => void deleteRule(rule.id)}
                    aria-label={t('deleteBlockedRule')}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
          </div>
          <div className="border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] text-zinc-500">{t('externalAccess')}</p>
                <p className="text-[9px] text-zinc-600">{t('externalAccessDescription')}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void grantExternalDirectory()}>
                {t('chooseDirectory')}
              </Button>
            </div>
            {rules
              .filter((rule) => rule.kind === 'external_directory')
              .map((rule) => (
                <div
                  key={rule.id}
                  className="mt-1 flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-[10px]"
                >
                  <ShieldAlert className="size-3 text-amber-400" />
                  <code className="min-w-0 flex-1 truncate text-zinc-500">{rule.value}</code>
                  <button
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300"
                    onClick={() => void deleteRule(rule.id)}
                    aria-label={t('revokeExternalAccess')}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      </details>
    </section>
  );
}
