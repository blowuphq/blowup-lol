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

/**
 * Verified-webhook settlement (architecture §4) — the ONLY path that turns
 * real money into rank. Invariants:
 *
 *  - Trust NOTHING from the client or the success-page redirect. Only events
 *    whose Stripe signature verified reach this module.
 *  - Idempotent under Stripe's at-least-once delivery. The event id gates
 *    processing (webhook_events insert-first); processed_at distinguishes
 *      fresh     -> run the handler
 *      unproc.   -> a previous attempt CRASHED mid-flight; re-run (safe: the
 *                   bids.payment_intent unique index backstops settlement,
 *                   and refunds tolerate charge_already_refunded)
 *      processed -> true duplicate, no-op
 *  - Amount comes from Stripe (session.amount_total), never from metadata.
 *  - Season resolution happens FRESH inside the money transaction. If the
 *    season the checkout targeted has ended (rolled over or none active),
 *    Q4 applies: AUTO-REFUND — never count the bid toward the wrong week.
 *  - PG commits first, Redis ZADD strictly after (ordering invariant §3).
 */

/** Structural surface of `stripe.refunds` — injectable for tests. */
export interface RefundApi {
  create(params: { payment_intent: string }): Promise<unknown>;
}

interface SessionLike {
  id: string;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
}

export interface VerifiedEventLike {
  id: string;
  type: string;
  data: { object: unknown };
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
 */
async function claimEvent(event: VerifiedEventLike): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length > 0) return true;

  const [existing] = await db
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, event.id));
  return existing?.processedAt == null;
}

async function markProcessed(eventId: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, eventId));
}

function markProcessedInTx(tx: Tx, eventId: string): Promise<void> {
  return tx
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, eventId))
    .then(() => undefined);
}

/**
 * Full refund via Stripe, tolerating redelivery after a crash between refund
 * and bookkeeping (a second full refund raises charge_already_refunded).
 */
async function refundOrTolerate(
  refunds: RefundApi | undefined,
  paymentIntentId: string,
): Promise<void> {
  if (!refunds) {
    throw new Error(
      'refund required but no Stripe client available (STRIPE_SECRET_KEY unset?)',
    );
  }
  try {
    await refunds.create({ payment_intent: paymentIntentId });
  } catch (err) {
    if (!isAlreadyRefunded(err)) throw err;
  }
}

/**
 * Process one signature-verified Stripe event. Returns a discriminable
 * outcome; throws only on infrastructure errors (the route turns those into
 * 500 so Stripe retries — every path here is safe to re-run).
 */
export async function processVerifiedEvent(
  event: VerifiedEventLike,
  refunds?: RefundApi,
): Promise<SettlementOutcome> {
  if (!(await claimEvent(event))) return { kind: 'duplicate_event' };

  const session = event.data.object as SessionLike;

  switch (event.type) {
    case 'checkout.session.async_payment_failed':
      await markProcessed(event.id);
      return { kind: 'async_payment_failed', sessionId: session.id };

    case 'checkout.session.completed':
      // Delayed-notification methods arrive 'unpaid' here; their outcome shows
      // up later as async_payment_succeeded/failed. Never settle unpaid.
      if ((session.payment_status ?? 'unpaid') === 'unpaid') {
        await markProcessed(event.id);
        return { kind: 'awaiting_payment', sessionId: session.id };
      }
      return settleSession(event.id, session, refunds);

    case 'checkout.session.async_payment_succeeded':
      return settleSession(event.id, session, refunds);

    default:
      await markProcessed(event.id);
      return { kind: 'ignored', eventType: event.type };
  }
}

async function settleSession(
  eventId: string,
  session: SessionLike,
  refunds?: RefundApi,
): Promise<SettlementOutcome> {
  const meta = session.metadata ?? {};
  const slug = meta.categorySlug ?? '';
  const handle = meta.handle ?? '';
  const name = meta.name || undefined;
  const intendedSeasonId = meta.seasonId ?? '';
  const paymentIntentId = session.payment_intent ?? null;
  const amountCents = session.amount_total ?? null;

  // Structural validation of a VERIFIED event. Anything unattributable must
  // not silently keep money: refund what we can identify, drop what we can't.
  const structurallyInvalid =
    !paymentIntentId ||
    !session.id ||
    typeof amountCents !== 'number' ||
    !slug ||
    !handle ||
    !intendedSeasonId;
  if (!structurallyInvalid) {
    try {
      assertBidAmount(amountCents as number);
    } catch {
      return refundUnattributable(eventId, refunds, paymentIntentId, 'amount_out_of_bounds');
    }
  }
  if (structurallyInvalid) {
    return refundUnattributable(
      eventId,
      refunds,
      paymentIntentId,
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
            checkoutSessionId: session.id,
            paymentIntentId: paymentIntentId!,
            bornPending: true,
          },
        },
        tx,
      );

      // Atomic with the settlement: settled implies processed.
      await markProcessedInTx(tx, eventId);
      return { result, slug: active.slug };
    });
  } catch (err) {
    if (err instanceof Q4Refund) {
      await refundOrTolerate(refunds, paymentIntentId!);
      await markProcessed(eventId);
      return { kind: 'refunded', reason: err.reason, paymentIntentId };
    }
    if (isUniqueViolation(err)) {
      // Same PaymentIntent under a different event id: already settled once.
      await markProcessed(eventId);
      return { kind: 'duplicate_settlement', paymentIntentId: paymentIntentId! };
    }
    throw err;
  }

  // ---- Post-commit: projection only. Failures here never roll back money. ----
  await safeZadd(
    leaderboardKey(settled.slug, settled.result.seasonId),
    settled.result.score,
    settled.result.creatorId,
  );
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
