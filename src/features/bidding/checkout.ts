import { CUSTOM_BID } from '../../config/site.js';
import { getActiveSeason } from '../../lib/redis.js';
import { getStripe } from '../../lib/stripe.js';
import { assertBidAmount } from './pipeline.js';

/**
 * Checkout session creation (architecture §4): the ONLY thing the public API
 * does before money moves. It validates, resolves the season, and hands off to
 * Stripe-hosted Checkout. No DB writes happen here — settlement is driven
 * exclusively by the verified webhook (settlement.ts).
 */

/** Fixed per-integration tag (stripe-best-practices: label + 8 random letters). */
const INTEGRATION_IDENTIFIER = 'blowup-bid-checkout-kqvztbmn';

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

/** Structural surface of `stripe.checkout.sessions` — injectable for tests. */
export interface CheckoutSessionsApi {
  create(params: {
    mode: 'payment';
    line_items: Array<{
      quantity: number;
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string };
      };
    }>;
    metadata: Record<string, string>;
    success_url: string;
    cancel_url: string;
    integration_identifier?: string;
  }): Promise<{ id: string; url: string | null }>;
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
  sessions: CheckoutSessionsApi = getStripe().checkout.sessions,
): Promise<CreatedCheckout> {
  if (!input.categorySlug || typeof input.categorySlug !== 'string') {
    throw new Error('categorySlug is required');
  }
  const handle = normalizeHandle(input.handle ?? '');
  assertBidAmount(input.amountCents);

  // Fail fast on unknown categories / seasons without an active one — before
  // we ever redirect the bidder to Stripe.
  const { season } = await getActiveSeason(input.categorySlug);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const session = await sessions.create({
    mode: 'payment',
    // NOTE: no payment_method_types — Stripe's dynamic payment method selection
    // applies (stripe-best-practices). Currency is USD-only for V1.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: input.amountCents,
          product_data: { name: `Blowup rank bid · ${handle}` },
        },
      },
    ],
    // Identity rides through to the webhook in metadata. Amount deliberately
    // NOT trusted from metadata at settlement time — Stripe's amount_total is
    // what was actually paid.
    metadata: {
      categorySlug: input.categorySlug,
      handle,
      name: input.name?.slice(0, 80) ?? '',
      seasonId: season.id,
    },
    success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    integration_identifier: INTEGRATION_IDENTIFIER,
  });

  if (!session.url) throw new Error('Stripe returned no checkout URL');
  return { sessionId: session.id, url: session.url };
}
