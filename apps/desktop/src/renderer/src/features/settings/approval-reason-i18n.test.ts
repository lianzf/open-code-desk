import { describe, expect, it } from 'vitest';

import { localizeApprovalReason } from './approval-reason-i18n';

describe('localizeApprovalReason', () => {
  it('translates canonical permission-policy reasons to Chinese', () => {
    expect(
      localizeApprovalReason(
        'zh-CN',
        'Every access to a user-granted external directory requires explicit approval.',
      ),
    ).toBe('每次访问用户授权的外部目录都需要明确批准。');
  });

  it('preserves English and unknown policy details', () => {
    expect(localizeApprovalReason('en-US', 'A side effect requires explicit approval.')).toBe(
      'A side effect requires explicit approval.',
    );
    expect(localizeApprovalReason('zh-CN', 'Plugin-specific approval reason.')).toBe(
      'Plugin-specific approval reason.',
    );
  });
});
