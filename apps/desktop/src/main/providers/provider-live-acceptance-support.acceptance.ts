import { providerKinds, type ProviderKind } from '@open-code-desk/provider-core';

import { validateCustomHeader, validateProviderBaseUrl } from './core/provider-network-policy';

export interface LiveProviderTarget {
  readonly kind: ProviderKind;
  readonly environmentSuffix: string;
  readonly apiKeyRequired: boolean;
}

export interface LiveProviderSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly customHeaders: Readonly<Record<string, string>>;
  readonly secretValues: ReadonlyArray<string>;
}

type LiveProviderEnvironment = Readonly<Record<string, string | undefined>>;

const environmentSuffixByKind: Readonly<Record<ProviderKind, string>> = {
  'openai-compatible': 'OPENAI_COMPATIBLE',
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
  gemini: 'GEMINI',
  openrouter: 'OPENROUTER',
  deepseek: 'DEEPSEEK',
  qwen: 'QWEN',
  glm: 'GLM',
  moonshot: 'MOONSHOT',
  ollama: 'OLLAMA',
};

export const liveProviderTargets: ReadonlyArray<LiveProviderTarget> = providerKinds.map((kind) => ({
  kind,
  environmentSuffix: environmentSuffixByKind[kind],
  apiKeyRequired: kind !== 'openai-compatible' && kind !== 'ollama',
}));

function variableName(target: LiveProviderTarget, field: string): string {
  return `OPEN_CODE_DESK_PROVIDER_${target.environmentSuffix}_${field}`;
}

function optionalValue(environment: LiveProviderEnvironment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseCustomHeaders(
  target: LiveProviderTarget,
  environment: LiveProviderEnvironment,
): Readonly<Record<string, string>> {
  const name = variableName(target, 'HEADERS_JSON');
  const raw = optionalValue(environment, name);
  if (raw === undefined) return {};

  let untrusted: unknown;
  try {
    untrusted = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${name} must be a JSON object containing string header values.`);
  }
  if (typeof untrusted !== 'object' || untrusted === null || Array.isArray(untrusted)) {
    throw new Error(`${name} must be a JSON object containing string header values.`);
  }

  const entries = Object.entries(untrusted);
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error(`${name} must contain only string header values.`);
  }
  for (const [headerName, value] of entries as ReadonlyArray<readonly [string, string]>) {
    if (headerName.trim() === '') {
      throw new Error(`${name} contains an empty header name.`);
    }
    validateCustomHeader(headerName, value);
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

export function parseLiveProviderSelection(input: string | undefined): ReadonlySet<ProviderKind> {
  const normalized = input?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') return new Set();
  if (normalized === 'all') return new Set(providerKinds);

  const selected = normalized
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const supported = new Set<string>(providerKinds);
  const invalid = selected.filter((entry) => !supported.has(entry));
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported live Provider selector(s): ${invalid.join(', ')}. Use all or: ${providerKinds.join(', ')}.`,
    );
  }
  return new Set(selected as ReadonlyArray<ProviderKind>);
}

export function readLiveProviderSettings(
  target: LiveProviderTarget,
  environment: LiveProviderEnvironment,
): LiveProviderSettings {
  const baseUrlName = variableName(target, 'BASE_URL');
  const modelName = variableName(target, 'MODEL');
  const apiKeyName = variableName(target, 'API_KEY');
  const baseUrl = optionalValue(environment, baseUrlName);
  const model = optionalValue(environment, modelName);
  const apiKey = optionalValue(environment, apiKeyName);
  const missing = [
    ...(baseUrl === undefined ? [baseUrlName] : []),
    ...(model === undefined ? [modelName] : []),
    ...(target.apiKeyRequired && apiKey === undefined ? [apiKeyName] : []),
  ];
  if (missing.length > 0) {
    throw new Error(`${target.kind} live acceptance is missing: ${missing.join(', ')}.`);
  }

  const customHeaders = parseCustomHeaders(target, environment);
  return {
    baseUrl: validateProviderBaseUrl(baseUrl!),
    model: model!,
    ...(apiKey === undefined ? {} : { apiKey }),
    customHeaders,
    secretValues: [apiKey, ...Object.values(customHeaders)].filter(
      (value): value is string => value !== undefined && value !== '',
    ),
  };
}

export function formatLiveProviderFailure(
  kind: ProviderKind,
  error: unknown,
  secretValues: ReadonlyArray<string>,
): string {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  for (const value of [...secretValues].sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(value, '[REDACTED]');
  }
  return `${kind} live acceptance failed: ${message}`;
}
