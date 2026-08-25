import 'dotenv/config';
import { assertLocalEnv } from '../src/lib/env-guard.js';

/**
 * Vitest globalSetup hook: runs once before any test file is collected, and a
 * throw here cancels the whole run — no suite, no worker, no connection.
 * The actual policy lives in src/lib/env-guard.ts, shared with the dev-* CLIs
 * so both entrypoints can never drift apart.
 */
export default function globalSetup(): void {
  assertLocalEnv();
}
