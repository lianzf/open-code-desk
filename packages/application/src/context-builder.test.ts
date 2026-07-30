import { describe, expect, it } from 'vitest';

import { ContextBuilder, createContextItem, estimateTokens } from './context-builder';

describe('ContextBuilder', () => {
  it('estimates CJK text more densely than ASCII text', () => {
    expect(estimateTokens('这是一个上下文估算测试')).toBeGreaterThan(
      estimateTokens('context estimate'),
    );
  });

  it('deduplicates content and retains the higher-priority source', () => {
    const result = new ContextBuilder().build(
      [
        createContextItem({
          id: 'old',
          type: 'file',
          title: 'old.ts',
          content: 'same content',
          priority: 10,
        }),
        createContextItem({
          id: 'selected',
          type: 'selection',
          title: 'Selected code',
          content: 'same content',
          priority: 100,
        }),
      ],
      { budget: 100 },
    );

    expect(result.items.map((item) => item.id)).toEqual(['selected']);
    expect(result.droppedItemIds).toContain('old');
  });

  it('truncates a high-priority item and stays within budget', () => {
    const result = new ContextBuilder().build(
      [
        createContextItem({
          id: 'large',
          type: 'file',
          title: 'large.ts',
          content: `${'head '.repeat(500)}\n${'tail '.repeat(500)}`,
          priority: 100,
        }),
        createContextItem({
          id: 'low',
          type: 'text',
          title: 'low priority',
          content: 'not selected',
          priority: 1,
        }),
      ],
      { budget: 100, minimumTruncationTokens: 10 },
    );

    expect(result.totalTokens).toBeLessThanOrEqual(100);
    expect(result.truncatedItemIds).toContain('large');
    expect(result.items[0]?.content).toContain('context truncated');
  });
});
