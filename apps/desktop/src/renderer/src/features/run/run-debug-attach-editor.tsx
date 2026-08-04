import type { ConfigurationDraft } from './run-configuration-draft';
import { runConfigurationInputClassName } from './run-configuration-draft';
import { useRunTranslation } from './run-i18n';

export function RunDebugAttachEditor({
  draft,
  onChange,
}: {
  readonly draft: ConfigurationDraft;
  readonly onChange: (draft: ConfigurationDraft) => void;
}) {
  const { t } = useRunTranslation();
  const python = draft.type === 'python';
  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <label className="flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.debugAttachEnabled}
          onChange={(event) =>
            onChange({
              ...draft,
              debugAttachEnabled: event.target.checked,
              executable:
                event.target.checked && draft.executable.trim() === ''
                  ? python
                    ? 'python'
                    : 'node'
                  : draft.executable,
              debugAttachPort:
                event.target.checked && !draft.debugAttachEnabled
                  ? python
                    ? '5678'
                    : '9229'
                  : draft.debugAttachPort,
            })
          }
          data-testid="run-config-debug-attach"
        />
        <span>
          <span className="block font-medium">
            {t(python ? 'attachExistingPython' : 'attachExistingNode')}
          </span>
          <span className="mt-1 block text-[11px] leading-5 text-zinc-500">
            {t(python ? 'attachExistingPythonHelp' : 'attachExistingNodeHelp')}
          </span>
        </span>
      </label>
      {!draft.debugAttachEnabled ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('debugEnvironment')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.debugAttachEnvironment}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    debugAttachEnvironment: event.target.value as 'remote' | 'container',
                  })
                }
                data-testid="run-config-debug-environment"
              >
                <option value="remote">{t('remoteTarget')}</option>
                <option value="container">{t('containerTarget')}</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('debugHost')}</span>
              <input
                className={runConfigurationInputClassName}
                value={draft.debugAttachHost}
                onChange={(event) => onChange({ ...draft, debugAttachHost: event.target.value })}
                placeholder="127.0.0.1"
                required
                data-testid="run-config-debug-host"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t(python ? 'debugpyPort' : 'debugPort')}</span>
              <input
                className={runConfigurationInputClassName}
                type="number"
                min={1}
                max={65_535}
                value={draft.debugAttachPort}
                onChange={(event) => onChange({ ...draft, debugAttachPort: event.target.value })}
                required
                data-testid="run-config-debug-port"
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>{t('remoteRoot')}</span>
            <input
              className={runConfigurationInputClassName}
              value={draft.debugAttachRemoteRoot}
              onChange={(event) =>
                onChange({ ...draft, debugAttachRemoteRoot: event.target.value })
              }
              placeholder={t('remoteRootPlaceholder')}
              data-testid="run-config-debug-remote-root"
            />
            <span className="block text-[11px] leading-5 text-amber-500/80">
              {t('debugAttachSecurityHelp')}
            </span>
          </label>
        </>
      )}
    </section>
  );
}
