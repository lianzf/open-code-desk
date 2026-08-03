import type {
  ProjectTask,
  ProjectTaskType,
  SaveProjectTaskRequest,
} from '@open-code-desk/ipc-contracts';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  nonEmptyLines,
  runConfigurationInputClassName,
  type EnvironmentDraft,
} from '../run/run-configuration-draft';
import { RunEnvironmentEditor } from '../run/run-environment-editor';
import { useProjectTaskTranslation } from './project-task-i18n';
import { useProjectTaskStore } from './project-task.store';

const taskTypes: ReadonlyArray<ProjectTaskType> = [
  'build',
  'clean',
  'test',
  'start',
  'package',
  'deploy',
  'lint',
  'typecheck',
  'custom',
];

interface TaskDraft {
  readonly name: string;
  readonly type: ProjectTaskType;
  readonly executable: string;
  readonly args: string;
  readonly workingDirectory: string;
  readonly environmentVariables: ReadonlyArray<EnvironmentDraft>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly timeoutSeconds: number;
}

function draftFromTask(task: ProjectTask | undefined): TaskDraft {
  if (task === undefined) {
    return {
      name: '',
      type: 'custom',
      executable: '',
      args: '',
      workingDirectory: '',
      environmentVariables: [],
      dependsOn: [],
      timeoutSeconds: 600,
    };
  }
  return {
    name: task.name,
    type: task.type,
    executable: task.executable,
    args: task.args.join('\n'),
    workingDirectory: task.workingDirectory,
    environmentVariables: task.environmentVariables.map((variable) => ({
      name: variable.name,
      value: variable.sensitive ? '' : (variable.value ?? ''),
      sensitive: variable.sensitive,
      configured: variable.configured,
    })),
    dependsOn: task.dependsOn,
    timeoutSeconds: task.timeoutMs / 1_000,
  };
}

export function ProjectTaskDialog() {
  const open = useProjectTaskStore((state) => state.dialogOpen);
  const editingTaskId = useProjectTaskStore((state) => state.editingTaskId);
  const tasks = useProjectTaskStore((state) => state.tasks);
  const workspaceId = useProjectTaskStore((state) => state.workspaceId);
  const editing = tasks.find((task) => task.id === editingTaskId);
  if (!open || workspaceId === undefined) return null;
  return (
    <ProjectTaskDialogForm
      key={editing?.id ?? 'new'}
      workspaceId={workspaceId}
      editing={editing}
      tasks={tasks}
    />
  );
}

function ProjectTaskDialogForm({
  workspaceId,
  editing,
  tasks,
}: {
  readonly workspaceId: string;
  readonly editing: ProjectTask | undefined;
  readonly tasks: ReadonlyArray<ProjectTask>;
}) {
  const { t } = useProjectTaskTranslation();
  const loading = useProjectTaskStore((state) => state.loading);
  const errorMessage = useProjectTaskStore((state) => state.errorMessage);
  const close = useProjectTaskStore((state) => state.closeDialog);
  const saveTask = useProjectTaskStore((state) => state.save);
  const deleteTask = useProjectTaskStore((state) => state.delete);
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(editing));

  const save = async () => {
    const input: SaveProjectTaskRequest = {
      ...(editing === undefined ? {} : { id: editing.id }),
      workspaceId,
      name: draft.name,
      type: draft.type,
      executable: draft.executable,
      args: [...nonEmptyLines(draft.args)],
      workingDirectory: draft.workingDirectory,
      environmentVariables: draft.environmentVariables
        .filter((variable) => variable.name.trim() !== '')
        .map((variable) => ({
          name: variable.name,
          ...(variable.value === '' && variable.sensitive && variable.configured
            ? {}
            : { value: variable.value }),
          sensitive: variable.sensitive,
        })),
      dependsOn: [...draft.dependsOn],
      timeoutMs: Math.round(draft.timeoutSeconds * 1_000),
    };
    try {
      await saveTask(input);
      close();
    } catch {
      // The store keeps the actionable error visible in the dialog.
    }
  };

  const dependencyCandidates = tasks.filter((task) => task.id !== editing?.id);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('projectTasks')}
      data-testid="project-task-dialog"
    >
      <section className="flex max-h-[94vh] w-[min(760px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              {editing === undefined
                ? t('newProjectTask')
                : t('editNamedTask', { name: editing.name })}
            </h2>
            <p className="text-[11px] text-zinc-500">{t('dialogDescription')}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={close}
            aria-label={t('closeProjectTask')}
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
                data-testid="project-task-name"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('taskType')}</span>
              <select
                className={runConfigurationInputClassName}
                value={draft.type}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, type: event.target.value as ProjectTaskType }))
                }
                data-testid="project-task-type"
              >
                {taskTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
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
              data-testid="project-task-executable"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('arguments')}</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-500"
                value={draft.args}
                onChange={(event) => setDraft((value) => ({ ...value, args: event.target.value }))}
                data-testid="project-task-args"
              />
            </label>
            <div className="space-y-4">
              <label className="block space-y-1.5 text-xs text-zinc-400">
                <span>{t('workingDirectory')}</span>
                <input
                  className={runConfigurationInputClassName}
                  value={draft.workingDirectory}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, workingDirectory: event.target.value }))
                  }
                  data-testid="project-task-cwd"
                />
              </label>
              <label className="block space-y-1.5 text-xs text-zinc-400">
                <span>{t('timeoutSeconds')}</span>
                <input
                  className={runConfigurationInputClassName}
                  type="number"
                  min={1}
                  max={86_400}
                  value={draft.timeoutSeconds}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      timeoutSeconds: Number(event.target.value),
                    }))
                  }
                  data-testid="project-task-timeout"
                />
              </label>
            </div>
          </div>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            <h3 className="text-xs font-semibold text-zinc-200">{t('taskDependencies')}</h3>
            <p className="mt-0.5 text-[11px] text-zinc-600">{t('dependencyHelp')}</p>
            {dependencyCandidates.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-600">{t('noDependencyCandidates')}</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {dependencyCandidates.map((task) => (
                  <label key={task.id} className="flex items-center gap-2 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={draft.dependsOn.includes(task.id)}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          dependsOn: event.target.checked
                            ? [...value.dependsOn, task.id]
                            : value.dependsOn.filter((id) => id !== task.id),
                        }))
                      }
                    />
                    <span>{task.name}</span>
                    <code className="text-[9px] text-zinc-600">{task.type}</code>
                  </label>
                ))}
              </div>
            )}
          </section>

          <RunEnvironmentEditor
            variables={draft.environmentVariables}
            onChange={(environmentVariables) =>
              setDraft((value) => ({ ...value, environmentVariables }))
            }
          />

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
            <Button
              type="button"
              variant="outline"
              className="text-red-300 hover:text-red-200"
              disabled={loading}
              onClick={() => {
                if (window.confirm(t('deleteConfirm', { name: editing.name }))) {
                  void deleteTask(editing.id);
                }
              }}
              data-testid="delete-project-task"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('delete')}
            </Button>
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
              !Number.isFinite(draft.timeoutSeconds) ||
              draft.timeoutSeconds < 1
            }
            onClick={() => void save()}
            data-testid="save-project-task"
          >
            {loading ? t('saving') : t('save')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
