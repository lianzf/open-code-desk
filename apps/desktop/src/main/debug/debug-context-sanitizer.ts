import { estimateTokens } from '@open-code-desk/application';
import type { DebugContextSection, DebugContextSectionKey } from '@open-code-desk/domain';

import { redactSensitiveText } from '../security/sensitive-text';

const redactionMarker = '[REDACTED]';

export interface DebugContextSectionInput {
  readonly key: DebugContextSectionKey;
  readonly title: string;
  readonly content: string;
  readonly selectedByDefault?: boolean;
  readonly sensitiveValues?: ReadonlyArray<string>;
  readonly maximumCharacters?: number;
  readonly forcedRedactionCount?: number;
}

function markerCount(value: string): number {
  return value.split(redactionMarker).length - 1;
}

function bounded(
  value: string,
  maximumCharacters: number,
): {
  readonly content: string;
  readonly truncated: boolean;
} {
  if (value.length <= maximumCharacters) return { content: value, truncated: false };
  const marker = '\n\n… OpenCode Desk 已截断此调试上下文 …\n\n';
  const available = Math.max(maximumCharacters - marker.length, 0);
  const head = Math.ceil(available * 0.75);
  return {
    content: `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`,
    truncated: true,
  };
}

/** Produces a bounded section whose content is safe to preview or persist. */
export function sanitizeDebugContextSection(input: DebugContextSectionInput): DebugContextSection {
  const originalMarkers = markerCount(input.content);
  const redacted = redactSensitiveText(input.content, input.sensitiveValues);
  const result = bounded(redacted, input.maximumCharacters ?? 16_000);
  return {
    key: input.key,
    title: input.title,
    content: result.content,
    tokenEstimate: estimateTokens(result.content),
    redactionCount:
      Math.max(markerCount(redacted) - originalMarkers, 0) + (input.forcedRedactionCount ?? 0),
    truncated: result.truncated,
    selectedByDefault: input.selectedByDefault ?? true,
  };
}
