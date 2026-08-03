import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*performance.acceptance.ts'],
    hookTimeout: 180_000,
    passWithNoTests: false,
    reporters: ['default'],
    testTimeout: 180_000,
  },
});
