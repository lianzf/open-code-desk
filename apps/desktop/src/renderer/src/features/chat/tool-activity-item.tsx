import { Wrench } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { localizeApprovalReason } from '@/features/settings/approval-reason-i18n';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { localizeMainProcessError } from '@/features/settings/main-process-error-i18n';

import type { DisplayToolActivity } from './chat.store';

const toolStatusLabels = {
  pending: 'toolPending',
  running: 'toolRunning',
  completed: 'toolCompleted',
  failed: 'statusFailed',
  cancelled: 'toolCancelled',
  rejected: 'toolRejected',
} as const;

function serializeInput(input: unknown, fallback: string): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return fallback;
  }
}

export function ToolActivityItem({ activity }: { readonly activity: DisplayToolActivity }) {
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string>();
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const decide = async (decision: 'approve' | 'reject') => {
    if (activity.approvalDigest === undefined) {
      return;
    }
    setDeciding(true);
    setDecisionError(undefined);
    try {
      await window.openCodeDesk.permissions.decideTool({
        callId: activity.id,
        expectedApprovalDigest: activity.approvalDigest,
        decision,
      });
    } catch (error) {
      const fallback = t('toolApprovalFailed');
      setDecisionError(
        error instanceof Error
          ? localizeMainProcessError(locale, error.message, undefined, fallback)
          : fallback,
      );
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div
      className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-1.5"
      data-testid="tool-activity"
    >
      <div className="flex items-center gap-1.5 text-[11px]">
        <Wrench className="size-3 text-amber-400" />
        <span className="font-medium text-zinc-300">{activity.name}</span>
        <span
          className={
            activity.status === 'completed'
              ? 'ml-auto text-emerald-400'
              : activity.status === 'running'
                ? 'ml-auto text-cyan-400'
                : 'ml-auto text-amber-400'
          }
        >
          {t(toolStatusLabels[activity.status])}
        </span>
      </div>
      {activity.input !== undefined ? (
        <details className="mt-1 text-[10px] text-zinc-500">
          <summary className="cursor-pointer">{t('viewArguments')}</summary>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap">
            {serializeInput(activity.input, t('unserializableArguments'))}
          </pre>
        </details>
      ) : null}
      {activity.errorMessage !== undefined ? (
        <p className="mt-1 text-[10px] text-red-400">{activity.errorMessage}</p>
      ) : null}
      {activity.status === 'pending' && activity.approvalDigest !== undefined ? (
        <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/20 p-2">
          <p className="text-[10px] leading-4 text-amber-200">
            {activity.approvalReason === undefined
              ? t('toolApprovalRequired')
              : localizeApprovalReason(locale, activity.approvalReason)}
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            {t('permission')}：{activity.permissionLevel ?? 'read'}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void decide('approve')} disabled={deciding}>
              {t('approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void decide('reject')}
              disabled={deciding}
            >
              {t('reject')}
            </Button>
          </div>
          {decisionError === undefined ? null : (
            <p className="mt-1 text-[10px] text-red-400">{decisionError}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
