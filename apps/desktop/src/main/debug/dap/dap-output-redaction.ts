import { StreamingSecretRedactor } from '../../run/run-process-runtime';

export const dapOutputCategories = [
  'console',
  'stdout',
  'stderr',
  'telemetry',
  'important',
] as const;

export type DapOutputCategory = (typeof dapOutputCategories)[number];

export function createDapOutputRedactors(
  sensitiveValues: ReadonlyArray<string>,
): Readonly<Record<DapOutputCategory, StreamingSecretRedactor>> {
  return Object.fromEntries(
    dapOutputCategories.map((category) => [category, new StreamingSecretRedactor(sensitiveValues)]),
  ) as Readonly<Record<DapOutputCategory, StreamingSecretRedactor>>;
}
