import type {
  ProjectType,
  RuntimeCandidate,
  RunConfiguration,
} from '@open-code-desk/ipc-contracts';
import { Copy, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  blankRunConfigurationDraft,
  draftFromRunConfiguration,
  isDebugAttachDraftValid,
  isRunPortDraftValid,
  projectTypes,
  runConfigurationInputClassName,
  toSaveRunConfigurationRequest,
  type ConfigurationDraft,
} from './run-configuration-draft';
import { RunEnvironmentEditor } from './run-environment-editor';
import { RunDebugAttachEditor } from './run-debug-attach-editor';
import { useRunTranslation } from './run-i18n';
import { RunPortEditor } from './run-port-editor';
import { useRunStore } from './run.store';

const noRuntimeCandidates: ReadonlyArray<RuntimeCandidate> = [];
const nodeAttachProjectTypes: ReadonlyArray<ProjectType> = [
  'node',
  'typescript',
  'react',
  'vue',
  'nextjs',
];

export function RunConfigurationDialog() {
  const open = useRunStore((state) => state.dialogOpen);
  const editingConfigurationId = useRunStore((state) => state.editingConfigurationId);
  const configurations = useRunStore((state) => state.configurations);
  const defaultConfigurationId = useRunStore((state) => state.defaultConfigurationId);
  const workspaceId = useRunStore((state) => state.workspaceId);
  const editing = configurations.find(
    (configuration) => configuration.id === editingConfigurationId,
  );

  if (!open || workspaceId === undefined) {
    return null;
  }

  return (
    <RunConfigurationDialogForm
      key={editing?.id ?? 'new'}
      workspaceId={workspaceId}
      editing={editing}
      defaultConfigurationId={defaultConfigurationId}
    />
  );
}

interface RunConfigurationDialogFormProps {
  readonly workspaceId: string;
  readonly editing: RunConfiguration | undefined;
  readonly defaultConfigurationId: string | null;
}

function RunConfigurationDialogForm({
  workspaceId,
  editing,
  defaultConfigurationId,
}: RunConfigurationDialogFormProps) {
  const { t } = useRunTranslation();
  const loading = useRunStore((state) => state.loading);
  const errorMessage = useRunStore((state) => state.errorMessage);
  const discoveredRuntimeCandidates = useRunStore((state) => state.detection?.runtimeCandidates);
  const projectTasks = useRunStore((state) => state.projectTasks);
  const runtimeCandidates = discoveredRuntimeCandidates ?? noRuntimeCandidates;
  const close = useRunStore((state) => state.closeConfigurationDialog);
  const saveConfiguration = useRunStore((state) => state.saveConfiguration);
  const deleteConfiguration = useRunStore((state) => state.deleteConfiguration);
  const duplicateConfiguration = useRunStore((state) => state.duplicateConfiguration);
  const setDefaultConfiguration = useRunStore((state) => state.setDefaultConfiguration);
  const [draft, setDraft] = useState<ConfigurationDraft>(() =>
    editing === undefined
      ? blankRunConfigurationDraft()
      : draftFromRunConfiguration(editing, defaultConfigurationId),
  );
  const save = async () => {
    const input = toSaveRunConfigurationRequest(draft, workspaceId, editing);

    try {
      const saved = await saveConfiguration(input);
      if (draft.makeDefault) {
        await setDefaultConfiguration(saved.id);
      } else if (defaultConfigurationId === saved.id) {
        await setDefaultConfiguration(null);
      }
      close();
    } catch {
      // The store keeps a user-readable error in the open dialog.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('runConfiguration')}
      data-testid="run-configuration-dialog"
    >
      <section className="flex max-h-[94vh] w-[min(780px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              {editing === undefined
                ? t('newRunConfiguration')
                : t('editConfiguration', { name: editing.name })}
            </h2>
            <p className="text-[11px] text-zinc-500">{t('argumentHelp')}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={close}
            aria-label={t('closeRunConfiguration')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('name')}</span>
              <input
                className={runConfigurationInputClassName}
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                required
                data-testid="run-config-name"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('projectType')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.type}
                onChange={(event) =>
                  setDraft((value) => {
                    const type = event.target.value as ProjectType;
                    return {
                      ...value,
                      type,
                      debugAttachEnabled:
                        value.debugAttachEnabled && nodeAttachProjectTypes.includes(type),
                    };
                  })
                }
                data-testid="run-config-type"
              >
                {projectTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('preLaunchTask')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.preLaunchTaskId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, preLaunchTaskId: event.target.value }))
                }
                data-testid="run-config-pre-launch-task"
              >
                <option value="">{t('none')}</option>
                {projectTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name} · {task.type}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('postRunTask')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.postRunTaskId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, postRunTaskId: event.target.value }))
                }
                data-testid="run-config-post-run-task"
              >
                <option value="">{t('none')}</option>
                {projectTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name} · {task.type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>{t('executable')}</span>
            <input
              className={runConfigurationInputClassName}
              value={draft.executable}
              onChange={(event) =>
                setDraft((value) => ({ ...value, executable: event.target.value }))
              }
              placeholder={t('executablePlaceholder')}
              required
              data-testid="run-config-executable"
            />
          </label>

          <RunPortEditor
            workspaceId={workspaceId}
            port={draft.port}
            electronDebugEndpoint={draft.type === 'electron'}
            onPortChange={(port) => setDraft((value) => ({ ...value, port }))}
          />

          {!nodeAttachProjectTypes.includes(draft.type) ? null : (
            <RunDebugAttachEditor draft={draft} onChange={setDraft} />
          )}

          {draft.type !== 'python' ? null : (
            <label className="block space-y-1.5 text-xs text-zinc-400">
              <span>{t('pythonInterpreter')}</span>
              <select
                className={runConfigurationInputClassName}
                value={
                  runtimeCandidates.some((candidate) => candidate.executable === draft.executable)
                    ? draft.executable
                    : ''
                }
                onChange={(event) => {
                  if (event.target.value !== '') {
                    setDraft((value) => ({ ...value, executable: event.target.value }));
                  }
                }}
                data-testid="run-config-python-interpreter"
              >
                <option value="">{t('keepManualInterpreter')}</option>
                {runtimeCandidates.map((candidate) => (
                  <option
                    key={`${candidate.source}:${candidate.executable}`}
                    value={candidate.executable}
                  >
                    {candidate.recommended ? t('recommendedPrefix') : ''}
                    {candidate.label}
                    {candidate.version === undefined ? '' : ` · Python ${candidate.version}`}
                    {candidate.available ? '' : t('unverifiedSuffix')}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] leading-5 text-zinc-500">
                {runtimeCandidates.find((candidate) => candidate.executable === draft.executable)
                  ?.reason ?? t('pythonInterpreterHelp')}
              </span>
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('runtimeArgs')}</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-500"
                value={draft.runtimeArgs}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, runtimeArgs: event.target.value }))
                }
                data-testid="run-config-runtime-args"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('programArgs')}</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-500"
                value={draft.args}
                onChange={(event) => setDraft((value) => ({ ...value, args: event.target.value }))}
                data-testid="run-config-args"
              />
            </label>
          </div>

          <label className="block space-y-1.5 text-xs text-zinc-400">
            <span>{t('workingDirectoryHelp')}</span>
            <input
              className={runConfigurationInputClassName}
              value={draft.workingDirectory}
              onChange={(event) =>
                setDraft((value) => ({ ...value, workingDirectory: event.target.value }))
              }
              data-testid="run-config-cwd"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('environmentFile')}</span>
              <input
                className={runConfigurationInputClassName}
                value={draft.environmentFile}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, environmentFile: event.target.value }))
                }
                placeholder={t('environmentFilePlaceholder')}
                data-testid="run-config-environment-file"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('outputDestination')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.console}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    console: event.target.value as ConfigurationDraft['console'],
                  }))
                }
                data-testid="run-config-console"
              >
                <option value="runOutput">{t('runOutput')}</option>
                <option value="integratedTerminal">{t('integratedTerminal')}</option>
              </select>
            </label>
          </div>

          <RunEnvironmentEditor
            variables={draft.environmentVariables}
            onChange={(environmentVariables) =>
              setDraft((value) => ({ ...value, environmentVariables }))
            }
          />

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={draft.makeDefault}
              onChange={(event) =>
                setDraft((value) => ({ ...value, makeDefault: event.target.checked }))
              }
            />
            {t('setDefault')}
          </label>

          {errorMessage === undefined ? null : (
            <p
              className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-zinc-800 px-5">
          {editing === undefined ? null : (
            <>
              <Button
                type="button"
                variant="outline"
                className="text-red-300 hover:text-red-200"
                disabled={loading}
                onClick={() => {
                  if (window.confirm(t('deleteConfigurationConfirm', { name: editing.name }))) {
                    void deleteConfiguration(editing.id);
                  }
                }}
                data-testid="delete-run-configuration"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('delete')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => void duplicateConfiguration(editing.id)}
                data-testid="duplicate-run-configuration"
              >
                <Copy className="size-4" aria-hidden="true" />
                {t('copy')}
              </Button>
            </>
          )}
          <Button type="button" variant="outline" className="ml-auto" onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={
              loading ||
              draft.name.trim() === '' ||
              draft.executable.trim() === '' ||
              !isDebugAttachDraftValid(draft) ||
              !isRunPortDraftValid(draft)
            }
            onClick={() => void save()}
            data-testid="save-run-configuration"
          >
            {loading ? t('saving') : t('save')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
