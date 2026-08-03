import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ProviderHeaderInput } from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import {
  capabilityToggles,
  fromConfiguration,
  type FormState,
  type HeaderDraft,
  inputClassName,
  type OpenAICompatibleFormProps,
} from './openai-compatible-form-state';

export function OpenAICompatibleForm({
  configuration,
  loading,
  providerKind,
  onSave,
}: OpenAICompatibleFormProps) {
  const [form, setForm] = useState<FormState>(() => fromConfiguration(configuration, providerKind));
  const [showApiKey, setShowApiKey] = useState(false);
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(locale, key, values);

  const updateHeader = (id: string, patch: Partial<HeaderDraft>) => {
    setForm((current) => ({
      ...current,
      headers: current.headers.map((header) =>
        header.id === id ? { ...header, ...patch } : header,
      ),
    }));
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const customHeaders: ProviderHeaderInput[] = form.headers.map((header) => ({
          name: header.name,
          ...(header.value === '' && header.configured ? {} : { value: header.value }),
          sensitive: header.sensitive,
          configured: header.configured,
        }));
        void onSave({
          ...(configuration === null ? {} : { id: configuration.id }),
          kind: providerKind,
          displayName: form.displayName,
          baseUrl: form.baseUrl,
          ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
          defaultModel: form.defaultModel,
          ...(form.fastModel.trim() === '' ? {} : { fastModel: form.fastModel.trim() }),
          ...(form.reasoningModel.trim() === ''
            ? {}
            : { reasoningModel: form.reasoningModel.trim() }),
          contextWindow: Number(form.contextWindow),
          toolCalling: form.toolCalling,
          vision: form.vision,
          streaming: form.streaming,
          customHeaders,
        }).then(() => {
          setForm((current) => ({ ...current, apiKey: '' }));
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>{t('configurationName')}</span>
          <input
            className={inputClassName}
            value={form.displayName}
            onChange={(event) =>
              setForm((current) => ({ ...current, displayName: event.target.value }))
            }
            required
            data-testid="provider-name"
          />
        </label>
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>Model ID</span>
          <input
            className={inputClassName}
            value={form.defaultModel}
            onChange={(event) =>
              setForm((current) => ({ ...current, defaultModel: event.target.value }))
            }
            placeholder="gpt-4.1-mini"
            required
            data-testid="provider-model"
          />
        </label>
      </div>

      <label className="block space-y-1.5 text-xs text-zinc-400">
        <span>Base URL</span>
        <input
          className={inputClassName}
          value={form.baseUrl}
          onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
          placeholder="https://api.example.com/v1"
          required
          data-testid="provider-base-url"
        />
        <span className="block text-[11px] text-zinc-600">{t('remoteHttpsHint')}</span>
      </label>

      <label className="block space-y-1.5 text-xs text-zinc-400">
        <span>API Key</span>
        <div className="relative">
          <input
            className={`${inputClassName} pr-10`}
            type={showApiKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder={
              configuration?.hasApiKey === true
                ? t('apiKeySavedPlaceholder')
                : t('apiKeyLocalPlaceholder')
            }
            autoComplete="off"
            data-testid="provider-api-key"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
            onClick={() => setShowApiKey((visible) => !visible)}
            aria-label={showApiKey ? t('hideApiKey') : t('showApiKey')}
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>{t('maximumContext')}</span>
          <input
            className={inputClassName}
            type="number"
            min={1024}
            value={form.contextWindow}
            onChange={(event) =>
              setForm((current) => ({ ...current, contextWindow: event.target.value }))
            }
            required
          />
        </label>
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>{t('fastModel')}</span>
          <input
            className={inputClassName}
            value={form.fastModel}
            onChange={(event) =>
              setForm((current) => ({ ...current, fastModel: event.target.value }))
            }
          />
        </label>
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>{t('reasoningModel')}</span>
          <input
            className={inputClassName}
            value={form.reasoningModel}
            onChange={(event) =>
              setForm((current) => ({ ...current, reasoningModel: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
        {capabilityToggles.map(({ key, labelKey }) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {t(labelKey)}
          </label>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">{t('customHeaders')}</h3>
            <p className="mt-1 text-[11px] text-zinc-600">{t('customHeadersDescription')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setForm((current) => ({
                ...current,
                headers: [
                  ...current.headers,
                  {
                    id: crypto.randomUUID(),
                    name: '',
                    value: '',
                    sensitive: false,
                    configured: false,
                  },
                ],
              }))
            }
          >
            <Plus className="size-3.5" />
            {t('add')}
          </Button>
        </div>
        {form.headers.map((header) => (
          <div
            key={header.id}
            className="grid gap-2 rounded-lg border border-zinc-800 p-3 sm:grid-cols-[1fr_1.4fr_auto_auto]"
          >
            <input
              className={inputClassName}
              value={header.name}
              onChange={(event) => updateHeader(header.id, { name: event.target.value })}
              placeholder="X-Organization"
              required
            />
            <input
              className={inputClassName}
              type={header.sensitive ? 'password' : 'text'}
              value={header.value}
              onChange={(event) =>
                updateHeader(header.id, {
                  value: event.target.value,
                  configured: false,
                })
              }
              placeholder={header.configured ? t('configuredValuePlaceholder') : t('value')}
            />
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={header.sensitive}
                onChange={(event) => updateHeader(header.id, { sensitive: event.target.checked })}
              />
              {t('sensitive')}
            </label>
            <button
              type="button"
              className="rounded p-2 text-zinc-500 hover:bg-red-950 hover:text-red-300"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  headers: current.headers.filter((item) => item.id !== header.id),
                }))
              }
              aria-label={t('deleteHeader', { name: header.name })}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading} data-testid="save-provider">
          {loading ? t('savingSecurely') : t('saveConfigurationSecurely')}
        </Button>
      </div>
    </form>
  );
}
