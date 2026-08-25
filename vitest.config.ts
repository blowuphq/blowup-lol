import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Refuses to run unless DATABASE_URL/REDIS_URL point at a local dev
    // instance — the suites truncate both (see tests/global-setup.ts).
    globalSetup: './tests/global-setup.ts',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Both suites truncate a SHARED dev Postgres/Redis in beforeEach — parallel
    // files would destroy each other's fixtures. Run files sequentially.
    fileParallelism: false,
  },
});
