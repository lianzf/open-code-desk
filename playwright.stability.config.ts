import { defineConfig } from '@playwright/test';

const durationMinutes = Number(process.env.OPEN_CODE_DESK_STABILITY_MINUTES ?? '0');
if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
  throw new Error('OPEN_CODE_DESK_STABILITY_MINUTES must be a non-negative number.');
}

export default defineConfig({
  testDir: './tests/acceptance',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/stability-report.json' }]],
  timeout: Math.max(5 * 60_000, durationMinutes * 60_000 + 5 * 60_000),
  use: {
    trace: durationMinutes >= 60 ? 'off' : 'retain-on-failure',
  },
});
