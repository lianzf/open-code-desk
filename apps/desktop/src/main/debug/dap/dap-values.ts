import type { DebugVariable } from '@open-code-desk/domain';

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};
}

export function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

export function stringValue(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function numberValue(record: UnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(record: UnknownRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function mapDapVariable(value: unknown): ReadonlyArray<DebugVariable> {
  const variable = asRecord(value);
  const name = stringValue(variable, 'name');
  const displayValue = stringValue(variable, 'value');
  const variablesReference = numberValue(variable, 'variablesReference');
  const type = stringValue(variable, 'type');
  const evaluateName = stringValue(variable, 'evaluateName');
  return name === undefined || displayValue === undefined || variablesReference === undefined
    ? []
    : [
        {
          name,
          value: displayValue,
          variablesReference,
          ...(type === undefined ? {} : { type }),
          ...(evaluateName === undefined ? {} : { evaluateName }),
        },
      ];
}
