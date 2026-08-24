import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema.js';

/**
 * Postgres client singleton (architecture §1 lib/db.ts).
 *
 * NOTE (deviation 3, docs/phase1-deviations.md): local/dev uses node-postgres.
 * Production targets Neon's serverless driver — APPROVED WITH CONDITION: the
 * swap must be explicitly verified at deploy time, not assumed.
 */

const globalForDb = globalThis as unknown as {
  blowupPool?: Pool;
};

export const pool: Pool =
  globalForDb.blowupPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.blowupPool = pool;
}

export const db = drizzle(pool, { schema });
