const bearerPattern = /\bBearer\s+\S+/giu;
const credentialShapePattern =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/gu;

/** Redacts configured values and common credential shapes before data crosses a trust boundary. */
export function redactSensitiveText(
  value: string,
  sensitiveValues: ReadonlyArray<string> = [],
): string {
  let redacted = value;
  const uniqueValues = [...new Set(sensitiveValues.filter((candidate) => candidate !== ''))].sort(
    (left, right) => right.length - left.length,
  );
  for (const sensitiveValue of uniqueValues) {
    redacted = redacted.replaceAll(sensitiveValue, '[REDACTED]');
  }
  return redacted
    .replaceAll(bearerPattern, 'Bearer [REDACTED]')
    .replaceAll(credentialShapePattern, '[REDACTED]');
}
