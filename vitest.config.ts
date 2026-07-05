import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/__tests__/**', '**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        statements: 93,
        branches: 81,
        functions: 97,
        lines: 94,
      },
    },
  },
});
