import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { useAppSettingsStore } from '@/features/settings/app-settings.store';

const zhCN = {
  requested: '请求',
  allowed: '允许',
  denied: '拒绝',
  started: '开始',
  succeeded: '成功',
  failed: '失败',
  cancelled: '取消',
  readFailed: '读取审计日志失败。',
  auditLog: '审计日志',
  recentEvents: '{count} 条近期事件',
  refreshAudit: '刷新审计日志',
  closeAudit: '关闭审计日志',
  noEvents: '尚无审计事件',
} as const;

export type AuditTranslationKey = keyof typeof zhCN;

const enUS: Record<AuditTranslationKey, string> = {
  requested: 'Requested',
  allowed: 'Allowed',
  denied: 'Denied',
  started: 'Started',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  readFailed: 'Failed to read the audit log.',
  auditLog: 'Audit log',
  recentEvents: '{count} recent events',
  refreshAudit: 'Refresh audit log',
  closeAudit: 'Close audit log',
  noEvents: 'No audit events',
};

const messages: Record<AppSettings['locale'], Record<AuditTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function translateAudit(
  locale: AppSettings['locale'],
  key: AuditTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key],
  );
}

export function useAuditTranslation(): {
  readonly locale: AppSettings['locale'];
  readonly t: (
    key: AuditTranslationKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
} {
  const locale = useAppSettingsStore((state) => state.settings.locale);
  return { locale, t: (key, values) => translateAudit(locale, key, values) };
}
