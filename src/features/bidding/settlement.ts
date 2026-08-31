import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { leaderboardKey, safeZadd } from '../../lib/redis.js';
import { categories, seasons, webhookEvents } from '../../db/schema.js';
import { CUSTOM_BID } from '../../config/site.js';
import {
  anonChannelId,
  assertBidAmount,
  getOrCreateCampaign,
  getOrCreateCreator,
  settlePaidBid,
  type SettleResult,
  type Tx,
} from './pipeline.js';
import { publishSettlement } from '../leaderboard/events.js';

/**
 * Verified-webhook settlement (architecture §4) — the ONLY path that turns
 * real money into rank. Invariants:
 *
 *  - Trust NOTHING from the client or the success-page redirect. Only events
 *    whose Dodo signature verified reach this module.
 *  - Idempotent under Dodo's at-least-once delivery. The payment_id gates
 *    processing (webhook_events insert-first); processed_at distinguishes
 *      fresh     -> run the handler
 *      unproc.   -> a previous attempt CRASHED mid-flight; re-run (safe: the
 *                   bids.payment_intent unique index backstops settlement,
 *                   and refunds tolerate already-refunded)
 *      processed -> true duplicate, no-op
 *  - Amount comes from Dodo (payment.total_amount), never from metadata.
 *  - Season resolution happens FRESH inside the money transaction. If the
 *    season the checkout targeted has ended (rolled over or none active),
 *    Q4 applies: AUTO-REFUND — never count the bid toward the wrong week.
 *  - PG commits first, Redis ZADD strictly after (ordering invariant §3).
 */

/** Structural surface of refunds API — injectable for tests. */
export interface RefundApi {
  create(params: { payment_id: string }): Promise<unknown>;
}


/** Dodo webhook event shape (UnwrapWebhookEvent discriminated union). */
export interface VerifiedEventLike {
  type: string;
  business_id: string;
  timestamp: string;
  data: unknown;
}

/** Payment fields we extract from Dodo's Payment object in webhook data. */
interface PaymentLike {
  payment_id: string;
  checkout_session_id?: string | null;
  total_amount: number;
  metadata?: Record<string, string> | null;
}

export type SettlementOutcome =
  | { kind: 'settled'; slug: string; result: SettleResult }
  /** Event fully processed before — no-op (at-least-once delivery). */
  | { kind: 'duplicate_event' }
  /** Different event id, same PaymentIntent — blocked by the unique index. */
  | { kind: 'duplicate_settlement'; paymentIntentId: string }
  /** checkout.session.completed while still unpaid (delayed notification methods). */
  | { kind: 'awaiting_payment'; sessionId: string }
  | { kind: 'async_payment_failed'; sessionId: string }
  | { kind: 'ignored'; eventType: string }
  /** Q4 auto-refund: no active season / season rolled over / unattributable payment. */
  | { kind: 'refunded'; reason: string; paymentIntentId: string | null };

function isUniqueViolation(err: unknown): boolean {
  const direct = (err as { code?: string } | undefined)?.code;
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return direct === '23505' || cause === '23505';
}

function isAlreadyRefunded(err: unknown): boolean {
  const rawCode = (err as { raw?: { code?: string } } | undefined)?.raw?.code;
  const message = err instanceof Error ? err.message : '';
  return rawCode === 'charge_already_refunded' || message.includes('already been refunded');
}

/**
 * Insert-first claim. Returns whether this delivery should run the handler:
 * fresh inserts and unprocessed leftovers (crashed attempts) both proceed;
 * only fully processed events are duplicates.
 *
 * For Dodo: payment_id is the idempotency key (replaces Stripe's event.id).
 */
async function claimEvent(paymentId: string, eventType: string): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: paymentId, type: eventType })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length > 0) return true;

  const [existing] = await db
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, paymentId));
  return existing?.processedAt == null;
}

async function markProcessed(paymentId: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, paymentId));
}

function markProcessedInTx(tx: Tx, paymentId: string): Promise<void> {
  return tx
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, paymentId))
    .then(() => undefined);
}

/**
 * Full refund via Dodo, tolerating redelivery after a crash between refund
 * and bookkeeping (a second full refund on an already-refunded payment may error).
 */
async function refundOrTolerate(
  refunds: RefundApi | undefined,
  paymentId: string,
): Promise<void> {
  if (!refunds) {
    throw new Error(
      'refund required but no Dodo client available (DODO_API_KEY unset?)',
    );
  }
  try {
    await refunds.create({ payment_id: paymentId });
  } catch (err) {
    if (!isAlreadyRefunded(err)) throw err;
  }
}

/**
 * Process one signature-verified Dodo webhook event. Returns a discriminable
 * outcome; throws only on infrastructure errors (the route turns those into
 * 500 so Dodo retries — every path here is safe to re-run).
 *
 * Event mapping (Dodo → Blowup outcome):
 *  - payment.succeeded → settle the bid
 *  - payment.failed → async_payment_failed
 *  - payment.cancelled → ignored
 *  - payment.processing → awaiting_payment
 */
export async function processVerifiedEvent(
  event: VerifiedEventLike,
  refunds?: RefundApi,
): Promise<SettlementOutcome> {
  const payment = event.data as any; // Cast to access fields since data union is complex
  const paymentId = payment.payment_id;

  if (!paymentId) {
    // Ignore events that don't have a payment_id (like non-payment events)
    return { kind: 'ignored', eventType: event.type };
  }

  if (!(await claimEvent(paymentId, event.type))) return { kind: 'duplicate_event' };

  switch (event.type) {
    case 'payment.failed':
      await markProcessed(paymentId);
      return { kind: 'async_payment_failed', sessionId: payment.checkout_session_id ?? paymentId };

    case 'payment.processing':
      await markProcessed(paymentId);
      return { kind: 'awaiting_payment', sessionId: payment.checkout_session_id ?? paymentId };

    case 'payment.cancelled':
      await markProcessed(paymentId);
      return { kind: 'ignored', eventType: event.type };

    case 'payment.succeeded':
      return settlePayment(paymentId, payment, refunds);

    default:
      await markProcessed(paymentId);
      return { kind: 'ignored', eventType: event.type };
  }
}

async function settlePayment(
  paymentId: string,
  payment: unknown,
  refunds?: RefundApi,
): Promise<SettlementOutcome> {
  const p = payment as PaymentLike;
  const meta = p.metadata ?? {};
  const slug = meta.categorySlug ?? '';
  const handle = meta.handle ?? '';
  const name = meta.name || undefined;
  const intendedSeasonId = meta.seasonId ?? '';
  const checkoutSessionId = p.checkout_session_id ?? null;
  const amountCents = p.total_amount;

  // Structural validation of a VERIFIED event. Anything unattributable must
  // not silently keep money: refund what we can identify, drop what we can't.
  const structurallyInvalid =
    !paymentId ||
    !checkoutSessionId ||
    typeof amountCents !== 'number' ||
    !slug ||
    !handle ||
    !intendedSeasonId;
  if (!structurallyInvalid) {
    try {
      assertBidAmount(amountCents as number);
    } catch {
      return refundUnattributable(paymentId, refunds, paymentId, 'amount_out_of_bounds');
    }
  }
  if (structurallyInvalid) {
    return refundUnattributable(
      paymentId,
      refunds,
      paymentId,
      'missing_metadata_or_fields',
    );
  }

  let settled: { result: SettleResult; slug: string };
  try {
    settled = await db.transaction(async (tx) => {
      // Fresh ACTIVE-season resolution INSIDE the money transaction — never
      // trust caches for source-of-truth decisions. The partial unique index
      // guarantees at most one active season per category.
      const [active] = await tx
        .select({
          seasonId: seasons.id,
          slug: categories.slug,
          categoryId: categories.id,
        })
        .from(seasons)
        .innerJoin(categories, eq(categories.id, seasons.categoryId))
        .where(and(eq(categories.slug, slug), eq(seasons.status, 'active')));

      // Q4: no active season for this category -> auto-refund.
      if (!active) {
        throw new Q4Refund('no_active_season');
      }
      // Season rolled over between checkout and webhook -> post-deadline bid:
      // refund per Q4 rather than counting money toward a week the bidder
      // never intended.
      if (active.seasonId !== intendedSeasonId) {
        throw new Q4Refund('season_rolled_over');
      }

      const creator = await getOrCreateCreator(tx, {
        youtubeChannelId: anonChannelId(handle),
        handle,
        name,
        categoryId: active.categoryId,
      });
      const campaign = await getOrCreateCampaign(tx, {
        creatorId: creator.id,
        seasonId: active.seasonId,
      });

      const result = await settlePaidBid(
        {
          seasonId: active.seasonId,
          creatorId: creator.id,
          campaignId: campaign.id,
          amountCents: amountCents as number,
          payment: {
            checkoutSessionId: checkoutSessionId!,
            paymentIntentId: paymentId, // payment_id is the new payment_intent equivalent
            bornPending: true,
          },
        },
        tx,
      );

      // Atomic with the settlement: settled implies processed.
      await markProcessedInTx(tx, paymentId);
      return { result, slug: active.slug };
    });
  } catch (err) {
    if (err instanceof Q4Refund) {
      await refundOrTolerate(refunds, paymentId);
      await markProcessed(paymentId);
      return { kind: 'refunded', reason: err.reason, paymentIntentId: paymentId };
    }
    if (isUniqueViolation(err)) {
      // Same payment_id under a different delivery: already settled once.
      await markProcessed(paymentId);
      return { kind: 'duplicate_settlement', paymentIntentId: paymentId };
    }
    throw err;
  }

  // ---- Post-commit: projection only. Failures here never roll back money. ----
  // The ZSET carries the tiebreak-adjusted score (R3) — raw score stays in PG.
  await safeZadd(
    leaderboardKey(settled.slug, settled.result.seasonId),
    settled.result.zsetScore,
    settled.result.creatorId,
  );
  // SSE fan-out (§3.B10) — the exact same publish path fake bids take.
  await publishSettlement(settled.slug, settled.result);
  return { kind: 'settled', slug: settled.slug, result: settled.result };
}

/** Control-flow marker for Q4 auto-refund outcomes inside the settlement txn. */
class Q4Refund extends Error {
  constructor(public reason: 'no_active_season' | 'season_rolled_over') {
    super(reason);
  }
}

async function refundUnattributable(
  eventId: string,
  refunds: RefundApi | undefined,
  paymentIntentId: string | null,
  reason: string,
): Promise<SettlementOutcome> {
  if (paymentIntentId) {
    await refundOrTolerate(refunds, paymentIntentId);
    console.error(`[settlement] event ${eventId}: refunded (${reason})`);
  } else {
    console.error(`[settlement] event ${eventId}: dropped without refund (${reason})`);
  }
  await markProcessed(eventId);
  return { kind: 'refunded', reason, paymentIntentId };
}
