import { processVerifiedEvent } from '../../../../features/bidding/settlement.js';
import { getDodo } from '../../../../lib/dodo.js';

/**
 * Dodo Payments webhook receiver (architecture §4). THE money entrypoint.
 *
 *  - Reads the RAW body before any parsing; signature verification uses
 *    Dodo's SDK unwrap() helper (wraps standardwebhooks) against DODO_WEBHOOK_SECRET.
 *  - Refunds require an API key. A refund-required event with no configured key
 *    throws -> 500 -> Dodo retries once the key exists, instead of silently
 *    dropping money owed back to a bidder.
 *  - Verified events always answer 200 (business outcomes included);
 *    unverified requests get 400; infrastructure errors get 500 so Dodo's
 *    at-least-once redelivery can heal them (settlement is idempotent).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] DODO_WEBHOOK_SECRET is not set');
    return new Response('webhook secret not configured', { status: 500 });
  }

  // Raw body FIRST — signature verification signs the exact bytes on the wire.
  const raw = await req.text();

  // Extract headers for webhook verification (standardwebhooks pattern)
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event;
  try {
    event = getDodo().webhooks.unwrap(raw, { headers, key: secret });
  } catch (err) {
    console.error(
      '[webhook] signature verification failed:',
      err instanceof Error ? err.message : err,
    );
    return new Response('invalid signature', { status: 400 });
  }

  try {
    const outcome = await processVerifiedEvent(event, getDodo().refunds);
    return Response.json({ received: true, outcome });
  } catch (err) {
    console.error(
      `[webhook] processing error for event type ${event.type}:`,
      err instanceof Error ? err.stack : err,
    );
    return new Response('processing error', { status: 500 });
  }
}
