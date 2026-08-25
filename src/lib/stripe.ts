import Stripe from 'stripe';

/**
 * Stripe client access. Two flavors, because the two money paths have
 * different key requirements:
 *
 *  - Signature VERIFICATION needs no API key at all (pure HMAC) — done via the
 *    static `Stripe.webhooks.constructEvent`, so webhook verification works
 *    even where STRIPE_SECRET_KEY is unset.
 *  - Session CREATION and REFUNDS need a key. getStripe() throws if unset;
 *    tryGetStripe() returns null so routes can degrade explicitly.
 */

let cached: Stripe | null = null;

export function tryGetStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key); // apiVersion: SDK default (latest pinned)
  return cached;
}

export function getStripe(): Stripe {
  const client = tryGetStripe();
  if (!client) {
    throw new Error('STRIPE_SECRET_KEY is not set — cannot call the Stripe API');
  }
  return client;
}
