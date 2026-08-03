import { describe, expect, it } from 'vitest';

import { upsertExecutableRuleRequestSchema } from './commands';

describe('command permission IPC contract', () => {
  it('accepts a bounded executable rule for a workspace-relative directory', () => {
    expect(
      upsertExecutableRuleRequestSchema.parse({
        workspaceId: '1c9f4764-13b6-4e18-8b62-baf9c6201cd8',
        kind: 'deny_executable',
        executable: 'pnpm',
        cwd: 'apps/desktop',
      }),
    ).toMatchObject({
      kind: 'deny_executable',
      executable: 'pnpm',
      cwd: 'apps/desktop',
      args: [],
    });
  });

  it('preserves an exact bounded argument vector for allow rules', () => {
    expect(
      upsertExecutableRuleRequestSchema.parse({
        workspaceId: '1c9f4764-13b6-4e18-8b62-baf9c6201cd8',
        kind: 'allow_executable',
        executable: 'node',
        args: ['--test', 'tests/unit test.ts'],
      }),
    ).toMatchObject({ args: ['--test', 'tests/unit test.ts'] });
  });

  it('rejects unknown rule kinds and shell-sized executable input', () => {
    expect(() =>
      upsertExecutableRuleRequestSchema.parse({
        workspaceId: '1c9f4764-13b6-4e18-8b62-baf9c6201cd8',
        kind: 'allow_all',
        executable: 'pnpm',
      }),
    ).toThrow();
    expect(() =>
      upsertExecutableRuleRequestSchema.parse({
        workspaceId: '1c9f4764-13b6-4e18-8b62-baf9c6201cd8',
        kind: 'allow_executable',
        executable: 'x'.repeat(1_001),
      }),
    ).toThrow();
  });
});
