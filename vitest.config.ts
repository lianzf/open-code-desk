import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    hookTimeout: 15_000,
    passWithNoTests: false,
    reporters: ['default'],
    testTimeout: 15_000,
  },
});
