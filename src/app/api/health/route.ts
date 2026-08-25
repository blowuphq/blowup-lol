import { sql } from 'drizzle-orm';
import { db } from '../../../lib/db.js';
import { categories } from '../../../db/schema.js';

/**
 * Connectivity probe (ops): proves the serverless runtime can reach Postgres
 * without going through the Stripe-gated checkout path (whose getStripe()
 * default-param throws before any query runs). Strictly read-only, and it
 * never echoes credentials or raw driver errors — failure detail goes to
 * function logs only, callers get a bare status.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    const [row] = await db
      .select({ categories: sql<number>`count(*)::int` })
      .from(categories);
    return Response.json({
      status: 'ok',
      db: { connected: true, categories: row?.categories ?? 0 },
    });
  } catch (err) {
    // Drizzle wraps driver errors — the actionable cause (e.g. `relation …
    // does not exist`, auth/TLS failures) sits one level down in err.cause.
    const message = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    console.error('[health] database check failed:', message, cause ? `(cause: ${cause})` : '');
    return Response.json(
      { status: 'degraded', db: { connected: false } },
      { status: 503 },
    );
  }
}
