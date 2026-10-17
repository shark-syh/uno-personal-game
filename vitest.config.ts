import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'apps/server/tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
