import { describe, expect, it, vi } from 'vitest';

import type { DapClient } from './dap-client';
import { setDapSpecialBreakpoints } from './dap-special-breakpoints';

describe('DAP special breakpoints', () => {
  it('marks unsupported data breakpoints as unverified without sending a fake request', async () => {
    const request = vi.fn();
    const client = { request } as unknown as DapClient;
    const now = new Date().toISOString();
    const result = await setDapSpecialBreakpoints(
      client,
      'data',
      [
        {
          id: '00000000-0000-4000-8000-000000000081',
          workspaceId: '00000000-0000-4000-8000-000000000082',
          relativePath: '@data/test',
          line: 1,
          kind: 'data',
          dataId: 'debugger-owned-data-id',
          dataAccessType: 'write',
          enabled: true,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
      ],
      false,
    );

    expect(request).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      status: 'unverified',
      message: '当前调试适配器不支持数据断点。',
    });
  });
});
