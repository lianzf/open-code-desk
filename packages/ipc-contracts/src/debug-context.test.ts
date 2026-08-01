import { describe, expect, it } from 'vitest';

import {
  attachDebugContextRequestSchema,
  debugContextSnapshotSchema,
  previewDebugContextRequestSchema,
} from './debug-context';

const sessionId = '00000000-0000-4000-8000-000000000001';
const conversationId = '00000000-0000-4000-8000-000000000002';
const workspaceId = '00000000-0000-4000-8000-000000000003';
const digest = 'a'.repeat(64);

describe('debug context IPC contracts', () => {
  it('accepts a bounded redacted preview', () => {
    expect(
      debugContextSnapshotSchema.parse({
        id: '00000000-0000-4000-8000-000000000004',
        sessionId,
        workspaceId,
        conversationId,
        pauseFingerprint: digest,
        digest,
        sections: [
          {
            key: 'exception',
            title: '异常',
            content: 'Error: failed',
            tokenEstimate: 4,
            redactionCount: 0,
            truncated: false,
            selectedByDefault: true,
          },
        ],
        totalTokenEstimate: 4,
        totalRedactionCount: 0,
        createdAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2026-08-02T00:10:00.000Z',
      }).sections[0]?.key,
    ).toBe('exception');
  });

  it('binds preview and attach requests to UUIDs and unique selected sections', () => {
    expect(previewDebugContextRequestSchema.parse({ sessionId, conversationId })).toEqual({
      sessionId,
      conversationId,
    });
    expect(() =>
      attachDebugContextRequestSchema.parse({
        snapshotId: sessionId,
        expectedDigest: digest,
        conversationId,
        selectedSections: ['exception', 'exception'],
      }),
    ).toThrow(/unique/iu);
  });
});
