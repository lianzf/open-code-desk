import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const selection = process.env.OPEN_CODE_DESK_PROVIDER_ACCEPTANCE?.trim();
if (selection === undefined || selection === '') {
  console.error(
    'Set OPEN_CODE_DESK_PROVIDER_ACCEPTANCE to all or a comma-separated Provider list before running live acceptance.',
  );
  process.exitCode = 1;
} else {
  const vitestCli = resolve(dirname(require.resolve('vitest')), 'vitest.mjs');
  const result = spawnSync(
    process.execPath,
    [
      vitestCli,
      'run',
      'apps/desktop/src/main/providers/provider-live.acceptance.test.ts',
      '--maxWorkers=1',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error !== undefined) {
    console.error(`Unable to start live Provider acceptance: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
