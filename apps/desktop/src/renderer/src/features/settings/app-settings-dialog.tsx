import { Keyboard, LoaderCircle, MonitorCog, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import {
  defaultShortcutSettings,
  type AppSettings,
  type UpdateAppSettingsRequest,
} from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { CrashReportList } from './crash-report-list';
import { translate } from './i18n';
import { useAppSettingsStore } from './app-settings.store';
import { UpdatePanel } from './update-panel';

const shortcutActions = [
  'openApplicationSettings',
  'openProviderSettings',
  'toggleTerminal',
  'toggleGit',
] as const;

export function AppSettingsDialog() {
  const { close, errorMessage, loading, open, settings, update } = useAppSettingsStore();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const t = (key: Parameters<typeof translate>[1]) => translate(draft.locale, key);

  if (!open) {
    return null;
  }

  const discard = () => {
    setDraft(settings);
    close();
  };

  const save = async () => {
    const input: UpdateAppSettingsRequest = {
      theme: draft.theme,
      locale: draft.locale,
      shortcuts: draft.shortcuts,
      autoCheckUpdates: draft.autoCheckUpdates,
      crashReporting: draft.crashReporting,
    };
    try {
      await update(input);
      close();
    } catch {
      // The store exposes a user-readable error while the dialog remains open.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('appSettings')}
      data-testid="app-settings-dialog"
    >
      <section className="flex h-[min(780px,94vh)] w-[min(820px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 px-5">
          <MonitorCog className="size-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t('appSettings')}</h2>
            <p className="text-[11px] text-zinc-500">{t('appSettingsDescription')}</p>
          </div>
          <button
            className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={discard}
            aria-label={t('cancel')}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-7 overflow-auto p-5">
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <MonitorCog className="size-4 text-zinc-500" />
              {t('appearance')}
            </h3>
            <div className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-zinc-400">
                <span>{t('theme')}</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      theme: event.target.value as AppSettings['theme'],
                    }))
                  }
                  data-testid="theme-select"
                >
                  <option value="system">{t('themeSystem')}</option>
                  <option value="dark">{t('themeDark')}</option>
                  <option value="light">{t('themeLight')}</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs text-zinc-400">
                <span>{t('language')}</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                  value={draft.locale}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      locale: event.target.value as AppSettings['locale'],
                    }))
                  }
                  data-testid="locale-select"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <ShieldCheck className="size-4 text-zinc-500" />
              {t('updatesAndRecovery')}
            </h3>
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <PreferenceToggle
                checked={draft.autoCheckUpdates}
                title={t('autoCheckUpdates')}
                description={t('autoCheckUpdatesDescription')}
                testId="auto-update-toggle"
                onChange={(checked) =>
                  setDraft((value) => ({ ...value, autoCheckUpdates: checked }))
                }
              />
              <PreferenceToggle
                checked={draft.crashReporting}
                title={t('crashReporting')}
                description={t('crashReportingDescription')}
                testId="crash-reporting-toggle"
                onChange={(checked) => setDraft((value) => ({ ...value, crashReporting: checked }))}
              />
              <UpdatePanel locale={draft.locale} />
              <CrashReportList locale={draft.locale} />
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Keyboard className="size-4 text-zinc-500" />
              <h3 className="text-xs font-semibold text-zinc-200">{t('shortcuts')}</h3>
              <button
                className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200"
                onClick={() =>
                  setDraft((value) => ({ ...value, shortcuts: defaultShortcutSettings }))
                }
              >
                <RotateCcw className="size-3" />
                {t('resetShortcuts')}
              </button>
            </div>
            <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 sm:grid-cols-2">
              {shortcutActions.map((action) => (
                <label key={action} className="space-y-1.5 text-xs text-zinc-400">
                  <span>{t(action)}</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 font-mono text-sm text-zinc-100 outline-none focus:border-cyan-500"
                    value={draft.shortcuts[action]}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        shortcuts: { ...value.shortcuts, [action]: event.target.value },
                      }))
                    }
                    data-testid={`shortcut-${action}`}
                  />
                </label>
              ))}
              <p className="text-[11px] leading-5 text-zinc-600 sm:col-span-2">
                {t('shortcutHint')}
              </p>
            </div>
          </section>

          {errorMessage === undefined ? null : (
            <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {errorMessage}
            </p>
          )}
        </div>

        <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5">
          <Button variant="outline" onClick={discard}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={loading} data-testid="save-app-settings">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {loading ? t('saving') : t('save')}
          </Button>
        </footer>
      </section>
    </div>
  );
}

interface PreferenceToggleProps {
  readonly checked: boolean;
  readonly description: string;
  readonly onChange: (checked: boolean) => void;
  readonly testId: string;
  readonly title: string;
}

function PreferenceToggle({
  checked,
  description,
  onChange,
  testId,
  title,
}: PreferenceToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 accent-cyan-400"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
      <span>
        <span className="block text-sm text-zinc-200">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-5 text-zinc-500">{description}</span>
      </span>
    </label>
  );
}
