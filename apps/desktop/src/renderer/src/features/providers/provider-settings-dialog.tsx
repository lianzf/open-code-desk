import { CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderKind } from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { OpenAICompatibleForm } from './openai-compatible-form';
import { useProviderStore } from './provider.store';

export function ProviderSettingsDialog() {
  const {
    closeSettings,
    configurations,
    delete: deleteProvider,
    descriptors,
    errorMessage,
    initialize,
    listModels,
    loading,
    models,
    save,
    settingsOpen,
    testConnection,
    testResult,
  } = useProviderStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<ProviderKind>('openai-compatible');
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(locale, key, values);

  useEffect(() => {
    if (settingsOpen) {
      void initialize();
    }
  }, [initialize, settingsOpen]);

  if (!settingsOpen) {
    return null;
  }

  const editing = configurations.find((configuration) => configuration.id === editingId) ?? null;
  const availableKinds = descriptors.filter((descriptor) => descriptor.available);
  const activeKind = editing?.kind ?? creatingKind;
  const activeDescriptor = descriptors.find((descriptor) => descriptor.kind === activeKind);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('modelSettings')}
      data-testid="provider-settings"
    >
      <div className="flex h-[min(850px,94vh)] w-[min(1100px,96vw)] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/70">
          <div className="border-b border-zinc-800 p-4">
            <p className="text-sm font-semibold text-zinc-100">{t('providerServices')}</p>
            <p className="mt-1 text-xs text-zinc-600">{t('providerSecretsLocal')}</p>
          </div>
          <div className="flex-1 space-y-1 overflow-auto p-2">
            {configurations.map((configuration) => (
              <button
                key={configuration.id}
                className={`w-full rounded-lg px-3 py-2 text-left ${
                  editingId === configuration.id
                    ? 'bg-cyan-400/10 text-cyan-200'
                    : 'text-zinc-400 hover:bg-zinc-800'
                }`}
                onClick={() => setEditingId(configuration.id)}
              >
                <span className="block truncate text-sm">{configuration.displayName}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
                  {configuration.defaultModel}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-800 p-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setEditingId(null)}
              disabled={availableKinds.length === 0}
            >
              <Plus className="size-4" />
              {t('addConfiguration')}
            </Button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                {editing === null
                  ? t('addProviderKind', { name: activeDescriptor?.name ?? activeKind })
                  : editing.displayName}
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-600">
                Provider Adapter：{activeDescriptor?.name ?? activeKind}
              </p>
            </div>
            <button
              className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={closeSettings}
              aria-label={t('closeModelSettings')}
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-5">
            {editing === null ? (
              <label className="mb-5 block space-y-1.5 text-xs text-zinc-400">
                <span>{t('providerVendor')}</span>
                <select
                  className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                  value={creatingKind}
                  onChange={(event) => setCreatingKind(event.target.value as ProviderKind)}
                  data-testid="provider-kind"
                >
                  {availableKinds.map((descriptor) => (
                    <option key={descriptor.kind} value={descriptor.kind}>
                      {descriptor.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <OpenAICompatibleForm
              key={editing?.id ?? `new-${creatingKind}`}
              configuration={editing}
              loading={loading}
              providerKind={activeKind}
              onSave={async (input) => {
                const saved = await save(input);
                setEditingId(saved.id);
                return saved;
              }}
            />

            {editing !== null ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-5">
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void testConnection(editing.id)}
                  data-testid="test-provider"
                >
                  {loading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  {t('testConnection')}
                </Button>
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void listModels(editing.id)}
                  data-testid="list-provider-models"
                >
                  <RefreshCw className="size-4" />
                  {t('listModels')}
                </Button>
                <Button
                  variant="outline"
                  className="text-red-300 hover:text-red-200"
                  disabled={loading}
                  onClick={() => {
                    if (window.confirm(t('deleteProviderConfirm', { name: editing.displayName }))) {
                      void deleteProvider(editing.id).then(() => setEditingId(null));
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                  {t('delete')}
                </Button>
              </div>
            ) : null}

            {testResult !== undefined ? (
              <p
                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  testResult.valid
                    ? 'border-emerald-900 bg-emerald-950/50 text-emerald-300'
                    : 'border-red-900 bg-red-950/50 text-red-300'
                }`}
                data-testid="provider-test-result"
              >
                {testResult.message}
              </p>
            ) : null}
            {errorMessage !== undefined ? (
              <p
                className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300"
                role="alert"
              >
                {errorMessage}
              </p>
            ) : null}
            {editing !== null && models[editing.id] !== undefined ? (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="text-xs font-medium text-zinc-300">
                  {t('modelsReturned', { value: models[editing.id]?.length ?? 0 })}
                </p>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                  {models[editing.id]?.map((model) => (
                    <div
                      key={model.id}
                      className="rounded bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-400"
                    >
                      <span className="block truncate text-zinc-300">{model.id}</span>
                      {model.capabilities === undefined ? null : (
                        <span className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                          {model.capabilities.streaming ? (
                            <span>{t('capabilityStreaming')}</span>
                          ) : null}
                          {model.capabilities.toolCalling ? (
                            <span>{t('capabilityTools')}</span>
                          ) : null}
                          {model.capabilities.vision ? <span>{t('capabilityVision')}</span> : null}
                          {model.capabilities.reasoning ? (
                            <span>{t('capabilityReasoning')}</span>
                          ) : null}
                          {model.capabilities.structuredOutput ? (
                            <span>{t('capabilityStructuredOutput')}</span>
                          ) : null}
                          {model.capabilities.contextWindow === undefined ? null : (
                            <span>{model.capabilities.contextWindow.toLocaleString()} tokens</span>
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
