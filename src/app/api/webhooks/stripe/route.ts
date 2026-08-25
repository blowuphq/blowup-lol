import Stripe from 'stripe';
import { processVerifiedEvent } from '../../../../features/bidding/settlement.js';
import { tryGetStripe } from '../../../../lib/stripe.js';

/**
 * Stripe webhook receiver (architecture §4). THE money entrypoint.
 *
 *  - Reads the RAW body before any parsing; signature verification uses
 *    Stripe's own constructEvent against STRIPE_WEBHOOK_SECRET.
 *  - Verification needs no API key; refunds do. A refund-required event with
 *    no configured key throws -> 500 -> Stripe retries once the key exists,
 *    instead of silently dropping money owed back to a bidder.
 *  - Verified events always answer 200 (business outcomes included);
 *    unverified requests get 400; infrastructure errors get 500 so Stripe's
 *    at-least-once redelivery can heal them (settlement is idempotent).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('webhook secret not configured', { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('missing stripe-signature header', { status: 400 });
  }

  // Raw body FIRST — constructEvent signs the exact bytes on the wire.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error(
      '[webhook] signature verification failed:',
      err instanceof Error ? err.message : err,
    );
    return new Response('invalid signature', { status: 400 });
  }

  try {
    const outcome = await processVerifiedEvent(event, tryGetStripe()?.refunds);
    return Response.json({ received: true, outcome });
  } catch (err) {
    console.error(
      `[webhook] processing error for ${event.id}:`,
      err instanceof Error ? err.stack : err,
    );
    return new Response('processing error', { status: 500 });
  }
}
