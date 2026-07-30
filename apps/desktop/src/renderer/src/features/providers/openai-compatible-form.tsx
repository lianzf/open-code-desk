import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  ProviderConfig,
  ProviderHeaderInput,
  SaveProviderRequest,
} from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';

interface OpenAICompatibleFormProps {
  readonly configuration: ProviderConfig | null;
  readonly loading: boolean;
  onSave(input: SaveProviderRequest): Promise<ProviderConfig>;
}

interface HeaderDraft {
  readonly id: string;
  name: string;
  value: string;
  sensitive: boolean;
  configured: boolean;
}

interface FormState {
  displayName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  fastModel: string;
  reasoningModel: string;
  contextWindow: string;
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  headers: HeaderDraft[];
}

const emptyForm: FormState = {
  displayName: 'OpenAI Compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: '',
  defaultModel: '',
  fastModel: '',
  reasoningModel: '',
  contextWindow: '128000',
  toolCalling: true,
  vision: false,
  streaming: true,
  headers: [],
};

function fromConfiguration(configuration: ProviderConfig | null): FormState {
  if (configuration === null) {
    return emptyForm;
  }
  return {
    displayName: configuration.displayName,
    baseUrl: configuration.baseUrl,
    apiKey: '',
    defaultModel: configuration.defaultModel,
    fastModel: configuration.fastModel ?? '',
    reasoningModel: configuration.reasoningModel ?? '',
    contextWindow: String(configuration.contextWindow),
    toolCalling: configuration.toolCalling,
    vision: configuration.vision,
    streaming: configuration.streaming,
    headers: configuration.customHeaders.map((header) => ({
      id: crypto.randomUUID(),
      name: header.name,
      value: header.value ?? '',
      sensitive: header.sensitive,
      configured: header.configured,
    })),
  };
}

const inputClassName =
  'h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500';
const capabilityToggles = [
  { key: 'toolCalling', label: '工具调用' },
  { key: 'vision', label: '图片输入' },
  { key: 'streaming', label: '流式响应' },
] as const;

export function OpenAICompatibleForm({
  configuration,
  loading,
  onSave,
}: OpenAICompatibleFormProps) {
  const [form, setForm] = useState<FormState>(() => fromConfiguration(configuration));
  const [showApiKey, setShowApiKey] = useState(false);

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
          kind: 'openai-compatible',
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
          <span>配置名称</span>
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
        <span className="block text-[11px] text-zinc-600">
          远程服务必须使用 HTTPS；仅 localhost/127.0.0.1 可使用 HTTP。
        </span>
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
              configuration?.hasApiKey === true ? '已安全保存；留空保持不变' : '由你本地填写'
            }
            autoComplete="off"
            data-testid="provider-api-key"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
            onClick={() => setShowApiKey((visible) => !visible)}
            aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>最大上下文</span>
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
          <span>快速模型（可选）</span>
          <input
            className={inputClassName}
            value={form.fastModel}
            onChange={(event) =>
              setForm((current) => ({ ...current, fastModel: event.target.value }))
            }
          />
        </label>
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span>高级推理模型（可选）</span>
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
        {capabilityToggles.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">自定义请求头</h3>
            <p className="mt-1 text-[11px] text-zinc-600">
              API Key、Token、Authorization 等名称会自动按敏感值加密保存。
            </p>
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
            添加
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
              placeholder={header.configured ? '已安全保存；留空保持' : '值'}
            />
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={header.sensitive}
                onChange={(event) => updateHeader(header.id, { sensitive: event.target.checked })}
              />
              敏感
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
              aria-label={`删除请求头 ${header.name}`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading} data-testid="save-provider">
          {loading ? '正在保存…' : '安全保存配置'}
        </Button>
      </div>
    </form>
  );
}
