import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { computeScore, toZsetScore } from '../../lib/rank-formula.js';
import { getActiveSeason, leaderboardKey, safeZadd } from '../../lib/redis.js';
import { activities, bids, campaigns, creators } from '../../db/schema.js';
import { CUSTOM_BID } from '../../config/site.js';
import { publishSettlement } from '../leaderboard/events.js';

/**
 * The ranking pipeline (architecture §3), driven end-to-end in Phase 2 by a
 * FAKE paid bid — no Stripe yet. A real webhook settlement (later phase) will
 * call the same `settleBidInSeason` core after signature verification.
 *
 * Invariants honored here:
 *  - Postgres is the source of truth: total/score/rank/activity all commit in
 *    ONE transaction under a per-season advisory lock BEFORE Redis is touched.
 *  - Campaign totals are recalculated FROM summed Bid rows (append-only), never
 *    incremented blindly (F1).
 *  - Ordering invariant: PG commit -> Redis ZADD. Never reversed (§3).
 *  - Redis failures never fail the money path (safeZadd logs; reconciler heals).
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root drizzle client or an open transaction (nested = savepoint). */
type Exec = typeof db | Tx;

export interface FakeBidInput {
  categorySlug: string;
  handle: string;
  name?: string;
  amountCents: number;
}

export type ActivityKind = 'joined_board' | 'rank_change' | 'bid';

export interface SettleResult {
  bidId: string;
  creatorId: string;
  campaignId: string;
  seasonId: string;
  previousRank: number | null;
  newRank: number | null;
  score: number;
  /**
   * R3: tiebreak-adjusted projection of `score` for Redis (score − ε·ordinal).
   * PG keeps the raw score; only the ZSET carries the folded value.
   */
  zsetScore: number;
  /** Position in the season-wide first-succeeded-bid ordering (1-based). */
  firstBidOrdinal: number;
  bidAmountCents: number;
  bidTotalCents: number;
  activityType: ActivityKind;
}

export function assertBidAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents)) throw new Error('amountCents must be an integer');
  if (amountCents < CUSTOM_BID.MIN_CENTS || amountCents > CUSTOM_BID.MAX_CENTS) {
    throw new Error(
      `bid must be between ${CUSTOM_BID.MIN_CENTS} and ${CUSTOM_BID.MAX_CENTS} cents ($5–$10,000)`,
    );
  }
}

/**
 * Deterministic anonymous channel id for the no-OAuth V1 flow (architecture Q1):
 * until the YouTube API exists (out of scope), a verified checkout's handle
 * mints a stable UCANON_ id instead of a real UC… channel id.
 */
export function anonChannelId(handle: string): string {
  return `UCANON_${handle.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()}`;
}

/** Get-or-create creator; the caller supplies the channel id (fake vs real flow). */
export async function getOrCreateCreator(
  tx: Tx,
  input: { youtubeChannelId: string; handle: string; name?: string; categoryId: number },
) {
  const existing = await tx.select().from(creators).where(eq(creators.handle, input.handle));
  if (existing[0]) return existing[0];

  await tx
    .insert(creators)
    .values({
      youtubeChannelId: input.youtubeChannelId,
      handle: input.handle,
      name: input.name ?? input.handle,
      categoryId: input.categoryId,
    })
    .onConflictDoNothing();
  const [created] = await tx.select().from(creators).where(eq(creators.handle, input.handle));
  if (!created) throw new Error(`failed to resolve creator for handle ${input.handle}`);
  return created;
}

export async function getOrCreateCampaign(
  tx: Tx,
  input: { creatorId: string; seasonId: string },
) {
  await tx
    .insert(campaigns)
    .values({ creatorId: input.creatorId, seasonId: input.seasonId })
    .onConflictDoNothing();
  const [campaign] = await tx
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.creatorId, input.creatorId), eq(campaigns.seasonId, input.seasonId)),
    );
  if (!campaign) throw new Error('failed to resolve campaign');
  return campaign;
}

/**
 * Core settlement: append the (paid) bid and recompute total -> score -> ranks
 * -> activity inside one locked Postgres transaction. Returns everything the
 * caller needs for post-commit projection writes.
 */
export interface RealPayment {
  checkoutSessionId: string;
  paymentIntentId: string;
  /**
   * Real webhook flow: insert the bid as 'pending', then flip it through the
   * trigger-whitelisted pending→succeeded transition (which stamps
   * status_updated_at). Fake bids omit this and are born succeeded.
   */
  bornPending?: boolean;
}

export async function settlePaidBid(
  input: {
    seasonId: string;
    creatorId: string;
    campaignId: string;
    amountCents: number;
    payment?: RealPayment;
  },
  exec: Exec = db,
): Promise<SettleResult> {
  assertBidAmount(input.amountCents);

  // When called with an open transaction this nests as a SAVEPOINT, keeping
  // creator/campaign/bid/scoring atomic in ONE Postgres transaction.
  return exec.transaction(async (tx) => {
    // Serialize all scoring within a season (architecture §3.B3). hashtext maps
    // the uuid to an int4 lock key; cross-season hash collisions merely add
    // contention, never incorrectness.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.seasonId}::text))`);

    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId));
    const previousRank = campaign.rank ?? null;

    // APPEND-ONLY insert. Fake bids are born 'succeeded' (they simulate a
    // verified webhook); real webhook settlement passes `payment` with real
    // Stripe ids and bornPending — the bid exists briefly as pending, then the
    // trigger-whitelisted transition flips it before totals are summed.
    const [bid] = await tx
      .insert(bids)
      .values({
        creatorId: input.creatorId,
        campaignId: input.campaignId,
        seasonId: input.seasonId,
        amountCents: input.amountCents,
        stripeCheckoutSessionId:
          input.payment?.checkoutSessionId ?? `cs_fake_${randomUUID()}`,
        stripePaymentIntentId: input.payment?.paymentIntentId ?? `pi_fake_${randomUUID()}`,
        paymentStatus: input.payment?.bornPending ? 'pending' : 'succeeded',
      })
      .returning();

    if (input.payment?.bornPending) {
      await tx
        .update(bids)
        .set({ paymentStatus: 'succeeded' })
        .where(eq(bids.id, bid.id));
    }

    // Total is DERIVED from summed Bid rows — never += (F1 / product rule).
    const totalRes = await tx.execute(
      sql`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM bids WHERE campaign_id = ${input.campaignId} AND payment_status = 'succeeded'`,
    );
    const bidTotalCents = Number((totalRes.rows[0] as { total: string | number }).total);

    const score = computeScore({ bidTotalCents, uniqueClicks: campaign.uniqueClicks });

    await tx.execute(
      sql`UPDATE campaigns SET bid_total_cents = ${bidTotalCents}, score = ${score}, updated_at = now() WHERE id = ${input.campaignId}`,
    );

    // Recompute ranks for the whole season deterministically:
    //   score DESC, then earlier first succeeded bid wins (tiebreak §3),
    //   then campaign id as a final deterministic key.
    await tx.execute(sql`
      WITH ranked AS (
        SELECT c.id,
               ROW_NUMBER() OVER (
                 ORDER BY c.score DESC,
                          fb.first_bid ASC NULLS LAST,
                          c.id ASC
               ) AS rn
        FROM campaigns c
        LEFT JOIN LATERAL (
          SELECT MIN(b.created_at) AS first_bid
          FROM bids b
          WHERE b.campaign_id = c.id AND b.payment_status = 'succeeded'
        ) fb ON TRUE
        WHERE c.season_id = ${input.seasonId} AND c.status = 'live'
      )
      UPDATE campaigns cs
      SET rank = ranked.rn
      FROM ranked
      WHERE cs.id = ranked.id AND cs.rank IS DISTINCT FROM ranked.rn
    `);

    // Read back this campaign's rank plus its firstBidOrdinal — the ROW_NUMBER
    // over the PG tiebreak keys (first succeeded bid ASC NULLS LAST, id ASC).
    // The ordinal is what the Redis projection folds into its score (R3); it
    // is stable for existing campaigns because bids are append-only, so new
    // campaigns only ever join at the END of the first_bid ordering.
    const afterRes = await tx.execute(sql`
      WITH live AS (
        SELECT c.id,
               c.rank,
               ROW_NUMBER() OVER (
                 ORDER BY fb.first_bid ASC NULLS LAST,
                          c.id ASC
               )::int AS ordinal
        FROM campaigns c
        LEFT JOIN LATERAL (
          SELECT MIN(b.created_at) AS first_bid
          FROM bids b
          WHERE b.campaign_id = c.id AND b.payment_status = 'succeeded'
        ) fb ON TRUE
        WHERE c.season_id = ${input.seasonId} AND c.status = 'live'
      )
      SELECT rank, ordinal FROM live WHERE id = ${input.campaignId}
    `);
    const after = (afterRes.rows[0] ?? { rank: null, ordinal: 1 }) as {
      rank: number | null;
      ordinal: number;
    };
    const newRank = after.rank ?? null;
    const firstBidOrdinal = after.ordinal;
    const zsetScore = toZsetScore(score, firstBidOrdinal);

    // Activity row for THIS event only (pushed-down rivals update silently in
    // rank until their own next event — architecture §3.B8 scope).
    const activityType: ActivityKind =
      previousRank === null ? 'joined_board' : newRank !== previousRank ? 'rank_change' : 'bid';

    await tx.insert(activities).values({
      seasonId: input.seasonId,
      creatorId: input.creatorId,
      type: activityType,
      previousRank,
      newRank,
      amountCents: input.amountCents,
    });

    return {
      bidId: bid.id,
      creatorId: input.creatorId,
      campaignId: input.campaignId,
      seasonId: input.seasonId,
      previousRank,
      newRank,
      score,
      zsetScore,
      firstBidOrdinal,
      bidAmountCents: input.amountCents,
      bidTotalCents,
      activityType,
    };
  });
}

/**
 * Dev-only entrypoint (Phase 2): fake a PAID bid and run the full pipeline.
 * The future POST /api/dev/fake-bid route will call exactly this.
 */
export async function recordFakeBid(input: FakeBidInput): Promise<SettleResult & { slug: string }> {
  assertBidAmount(input.amountCents);
  const { category, season } = await getActiveSeason(input.categorySlug);

  const result = await db.transaction(async (tx) => {
    const creator = await getOrCreateCreator(tx, {
      youtubeChannelId: `UCFAKE_${input.handle.replace(/^@/, '').toUpperCase()}`,
      handle: input.handle,
      name: input.name,
      categoryId: category.id,
    });
    const campaign = await getOrCreateCampaign(tx, {
      creatorId: creator.id,
      seasonId: season.id,
    });
    return settlePaidBid(
      {
        seasonId: season.id,
        creatorId: creator.id,
        campaignId: campaign.id,
        amountCents: input.amountCents,
      },
      tx,
    );
  });

  // ---- Post-commit: projection only. Failures here never roll back money. ----
  // The ZSET carries the tiebreak-adjusted score (R3) — raw score stays in PG.
  await safeZadd(leaderboardKey(category.slug, season.id), result.zsetScore, result.creatorId);
  // SSE fan-out (§3.B10) — same publish path the real webhook uses.
  await publishSettlement(category.slug, result);

  return { ...result, slug: category.slug };
}
