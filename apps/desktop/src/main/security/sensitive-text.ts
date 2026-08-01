const bearerPattern = /\bBearer\s+\S+/giu;
const credentialShapePattern =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/gu;
const credentialAssignmentPattern =
  /((?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|client[_-]?secret|private[_-]?key|database[_-]?url)\b|["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|client[_-]?secret|private[_-]?key|database[_-]?url)["'])\s*[:=]\s*)(?:["'][^"'\r\n]*["']|\[[^\]\r\n]*\]|[^\s,;\]}]+)/giu;
const credentialUrlPattern = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/giu;

const sensitiveNamePattern =
  /(?:^|[_\-.])(api[_-]?key|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|secret|private[_-]?key|credential|cookie|session[_-]?key|database[_-]?url)(?:$|[_\-.])/iu;

export function isSensitiveName(value: string): boolean {
  return sensitiveNamePattern.test(value.trim());
}

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
    .replaceAll(credentialShapePattern, '[REDACTED]')
    .replaceAll(credentialAssignmentPattern, '$1[REDACTED]')
    .replaceAll(credentialUrlPattern, '$1[REDACTED]@');
}
