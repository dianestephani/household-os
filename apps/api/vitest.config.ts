import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    include: ['src/**/*.test.ts'],
    /**
     * DB tests share collection state — running in a single worker keeps the
     * setup simple. Pure unit tests can opt into parallelism later if it
     * matters.
     */
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
