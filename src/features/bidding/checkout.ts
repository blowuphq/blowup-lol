import { CUSTOM_BID } from '../../config/site.js';
import { getActiveSeason } from '../../lib/redis.js';
import { getDodo } from '../../lib/dodo.js';
import { assertBidAmount } from './pipeline.js';

/**
 * Checkout session creation (architecture §4): the ONLY thing the public API
 * does before money moves. It validates, resolves the season, and hands off to
 * Dodo-hosted Checkout. No DB writes happen here — settlement is driven
 * exclusively by the verified webhook (settlement.ts).
 */

export interface CheckoutRequest {
  categorySlug: string;
  handle: string;
  amountCents: number;
  name?: string;
}

export interface CreatedCheckout {
  sessionId: string;
  url: string;
}

/**
 * YouTube handles: 3–30 chars of [A-Za-z0-9._-]. Accept with or without the
 * leading @; always store normalized WITH a leading @ and lowercased so
 * creator identity is deterministic.
 */
export function normalizeHandle(raw: string): string {
  const bare = raw.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(bare)) {
    throw new Error(
      'handle must be 3–30 chars of a–z, 0–9, dot, underscore or dash (with optional leading @)',
    );
  }
  return `@${bare}`;
}

export async function createCheckoutSession(
  input: CheckoutRequest,
): Promise<CreatedCheckout> {
  if (!input.categorySlug || typeof input.categorySlug !== 'string') {
    throw new Error('categorySlug is required');
  }
  const handle = normalizeHandle(input.handle ?? '');
  assertBidAmount(input.amountCents);

  // Fail fast on unknown categories / seasons without an active one — before
  // we ever redirect the bidder to Dodo.
  const { season } = await getActiveSeason(input.categorySlug);

  const productId = process.env.DODO_BID_PRODUCT_ID;
  if (!productId) {
    throw new Error('DODO_BID_PRODUCT_ID is not set — cannot create checkout session');
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const session = await getDodo().checkoutSessions.create({
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        amount: input.amountCents, // Pay-what-you-want: dynamic amount above the product's floor
      },
    ],
    // Identity rides through to the webhook in metadata. Amount deliberately
    // NOT trusted from metadata at settlement time — Dodo's total_amount is
    // what was actually paid.
    metadata: {
      categorySlug: input.categorySlug,
      handle,
      name: input.name?.slice(0, 80) ?? '',
      seasonId: season.id,
    },
    return_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    billing_currency: 'USD',
  });

  if (!session.checkout_url) throw new Error('Dodo returned no checkout URL');
  return { sessionId: session.session_id, url: session.checkout_url };
}
