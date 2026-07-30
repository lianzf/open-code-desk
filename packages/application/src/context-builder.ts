import type { ContextItem } from '@open-code-desk/domain';

export interface ContextBuildResult {
  readonly items: ReadonlyArray<ContextItem>;
  readonly totalTokens: number;
  readonly droppedItemIds: ReadonlyArray<string>;
  readonly truncatedItemIds: ReadonlyArray<string>;
}

export interface ContextBuildOptions {
  readonly budget: number;
  readonly maximumItemTokens?: number;
  readonly minimumTruncationTokens?: number;
}

const defaultMaximumItemTokens = 16_000;
const defaultMinimumTruncationTokens = 64;

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  );
}

export function estimateTokens(content: string): number {
  let narrowCharacters = 0;
  let wideCharacters = 0;
  for (const character of content) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isWideCodePoint(codePoint)) {
      wideCharacters += 1;
    } else {
      narrowCharacters += 1;
    }
  }
  return Math.max(1, Math.ceil(narrowCharacters / 4 + wideCharacters / 1.5));
}

export function createContextItem(
  input: Omit<ContextItem, 'tokenEstimate'> & { readonly tokenEstimate?: number },
): ContextItem {
  return {
    ...input,
    tokenEstimate: input.tokenEstimate ?? estimateTokens(input.content),
  };
}

function normalizedContentKey(item: ContextItem): string {
  return item.content.replaceAll('\r\n', '\n').trim();
}

function deduplicate(items: ReadonlyArray<ContextItem>): {
  readonly items: ReadonlyArray<ContextItem>;
  readonly droppedIds: ReadonlyArray<string>;
} {
  const retainedByContent = new Map<
    string,
    { readonly item: ContextItem; readonly index: number }
  >();
  const droppedIds: string[] = [];

  items.forEach((item, index) => {
    const key = normalizedContentKey(item);
    const existing = retainedByContent.get(key);
    if (existing === undefined) {
      retainedByContent.set(key, { item, index });
      return;
    }
    if (item.priority > existing.item.priority) {
      retainedByContent.set(key, { item, index });
      droppedIds.push(existing.item.id);
    } else {
      droppedIds.push(item.id);
    }
  });

  return {
    items: [...retainedByContent.values()]
      .sort((left, right) => left.index - right.index)
      .map(({ item }) => item),
    droppedIds,
  };
}

function truncateContent(content: string, tokenBudget: number): string {
  const targetCharacters = Math.max(1, tokenBudget * 3);
  if (content.length <= targetCharacters) {
    return content;
  }
  const marker = '\n\n… context truncated …\n\n';
  const remainingCharacters = Math.max(2, targetCharacters - marker.length);
  const headLength = Math.ceil(remainingCharacters * 0.65);
  const tailLength = remainingCharacters - headLength;
  return `${content.slice(0, headLength)}${marker}${content.slice(-tailLength)}`;
}

export class ContextBuilder {
  public build(
    untrustedItems: ReadonlyArray<ContextItem>,
    options: ContextBuildOptions,
  ): ContextBuildResult {
    if (!Number.isSafeInteger(options.budget) || options.budget <= 0) {
      throw new Error('Context token budget must be a positive safe integer.');
    }
    const maximumItemTokens = options.maximumItemTokens ?? defaultMaximumItemTokens;
    const minimumTruncationTokens =
      options.minimumTruncationTokens ?? defaultMinimumTruncationTokens;
    const normalizedItems = untrustedItems.map((item) => createContextItem(item));
    const deduplicated = deduplicate(normalizedItems);
    const ordered = deduplicated.items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => right.item.priority - left.item.priority || left.index - right.index);

    let remaining = options.budget;
    const selected: ContextItem[] = [];
    const droppedIds = [...deduplicated.droppedIds];
    const truncatedIds: string[] = [];

    for (const { item } of ordered) {
      if (remaining <= 0) {
        droppedIds.push(item.id);
        continue;
      }
      const desiredTokens = Math.min(item.tokenEstimate, maximumItemTokens);
      const availableTokens = Math.min(desiredTokens, remaining);
      if (availableTokens < minimumTruncationTokens && item.tokenEstimate > availableTokens) {
        droppedIds.push(item.id);
        continue;
      }
      if (availableTokens < item.tokenEstimate) {
        const content = truncateContent(item.content, availableTokens);
        const truncated = {
          ...item,
          content,
          tokenEstimate: Math.min(availableTokens, estimateTokens(content)),
        };
        selected.push(truncated);
        remaining -= truncated.tokenEstimate;
        truncatedIds.push(item.id);
      } else {
        selected.push(item);
        remaining -= item.tokenEstimate;
      }
    }

    return {
      items: selected,
      totalTokens: options.budget - remaining,
      droppedItemIds: droppedIds,
      truncatedItemIds: truncatedIds,
    };
  }
}
