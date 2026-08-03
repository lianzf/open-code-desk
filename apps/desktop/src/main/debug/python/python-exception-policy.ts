import type { DebugExceptionInfo } from '@open-code-desk/domain';

export function matchesPythonExceptionType(
  exception: DebugExceptionInfo,
  configuredTypes: ReadonlyArray<string>,
): boolean {
  const candidates = [exception.typeName, exception.exceptionId]
    .filter((value): value is string => value !== undefined)
    .flatMap(exceptionTypeNames);
  return configuredTypes
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .flatMap(exceptionTypeNames)
    .some((configured) => candidates.includes(configured));
}

function exceptionTypeNames(value: string): ReadonlyArray<string> {
  const name = value.split(':', 1)[0]?.trim() ?? '';
  if (name === '') return [];
  const shortName = name.slice(name.lastIndexOf('.') + 1);
  return shortName === name ? [name] : [name, shortName];
}
