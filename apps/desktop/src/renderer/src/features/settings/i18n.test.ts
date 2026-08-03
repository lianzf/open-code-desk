import { describe, expect, it } from 'vitest';

import { translate } from './i18n';

describe('renderer translations', () => {
  it('translates core chat controls and interpolates values in both locales', () => {
    expect(translate('zh-CN', 'send')).toBe('发送');
    expect(translate('en-US', 'send')).toBe('Send');
    expect(translate('zh-CN', 'attempt', { value: 3 })).toBe('第 3 次尝试');
    expect(translate('en-US', 'attempt', { value: 3 })).toBe('Attempt 3');
  });
});
