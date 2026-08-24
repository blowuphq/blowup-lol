import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Both suites truncate a SHARED dev Postgres/Redis in beforeEach — parallel
    // files would destroy each other's fixtures. Run files sequentially.
    fileParallelism: false,
  },
});
