import type { NextRequest } from 'next/server';
import { recordFakeBid } from '../../../../features/bidding/pipeline.js';
import { assertLocalEnv } from '../../../../lib/env-guard.js';

/**
 * DEV-ONLY HTTP entrypoint for the fake-bid pipeline — the browser-drivable
 * form of `npm run dev:fake-bid`. Runs the exact same settlement code path
 * as a verified Stripe webhook (PG txn → ZADD → SSE publish), so UI demos
 * and load tests exercise production behavior.
 *
 * Double-guarded so this can NEVER touch production:
 *   1. refuses under NODE_ENV=production (the deployed runtime), AND
 *   2. assertLocalEnv() refuses any DATABASE_URL/REDIS_URL that doesn't point
 *      at a loopback instance (see src/lib/env-guard.ts).
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'dev endpoint disabled in production' }, { status: 404 });
  }
  try {
    assertLocalEnv();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }

  let body: { slug?: string; handle?: string; amountCents?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { slug, handle, amountCents } = body;
  if (!slug || !handle || typeof amountCents !== 'number' || !Number.isInteger(amountCents)) {
    return Response.json(
      { error: 'required: { slug, handle, amountCents (integer cents) }' },
      { status: 400 },
    );
  }

  try {
    const result = await recordFakeBid({
      categorySlug: slug,
      handle,
      amountCents: amountCents as number,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
