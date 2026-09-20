import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns, creators, activities } from '../../db/schema.js';
import { publishBoardEvent, type RankDeltaPayload, type ActivityFeedPayload } from '../../lib/sse.js';
import type { SettleResult } from '../bidding/pipeline.js';

/**
 * Rank-delta publishing (architecture §3.B10): ONE composer used by BOTH
 * settlement paths — the dev/fake pipeline and the real Dodo Payments webhook — so
 * connected clients behave identically no matter which path moved money.
 *
 * Payload = the documented `{type:'rank_delta', entries:[…], activity:{…}}`
 * plus per-entry DISPLAY fields (handle/avatar/subscribers/totals) so a
 * client can render a newly-joined creator without a follow-up fetch.
 * Events carry absolute state (newRank + score), never diffs — replaying a
 * stream from any point converges to truth, which is what makes
 * Last-Event-ID catch-up and the §3C "one fresh fetch" idempotent.
 *
 * Publishing happens strictly AFTER PG commit + Redis ZADD (ordering
 * invariant) and fails open like every other projection write.
 */
export async function publishSettlement(slug: string, result: SettleResult): Promise<void> {
  try {
    const [row] = await db
      .select({
        handle: creators.handle,
        name: creators.name,
        avatarUrl: creators.avatarUrl,
        subscriberCount: creators.subscriberCount,
        bidTotalCents: campaigns.bidTotalCents,
        uniqueClicks: campaigns.uniqueClicks,
      })
      .from(campaigns)
      .innerJoin(creators, eq(creators.id, campaigns.creatorId))
      .where(eq(campaigns.id, result.campaignId));

    const entry: RankDeltaPayload['entries'][number] = {
      creatorId: result.creatorId,
      newRank: result.newRank,
      score: result.score,
      handle: row?.handle ?? '',
      name: row?.name ?? null,
      avatarUrl: row?.avatarUrl ?? null,
      subscriberCount: row?.subscriberCount ?? null,
      bidTotalCents: Number(row?.bidTotalCents ?? result.bidTotalCents),
      uniqueClicks: Number(row?.uniqueClicks ?? 0),
    };

    await publishBoardEvent(slug, {
      type: 'rank_delta',
      entries: [entry],
      activity: {
        type: result.activityType,
        previousRank: result.previousRank,
        newRank: result.newRank,
        amountCents: result.bidAmountCents,
      },
    });
  } catch (err) {
    // Projection-only concern: never surface into the money path.
    console.error(`[sse] publishSettlement failed slug=${slug}:`, err);
  }
}

/**
 * Activity feed publishing (Phase 6): publishes the latest activity entries
 * for the season so connected clients can render a live "recent activity" ticker.
 * Called AFTER the settlement transaction commits, same as publishSettlement.
 * Fail-open: projection failures never block money flow.
 */
export async function publishActivityFeed(slug: string, seasonId: string): Promise<void> {
  try {
    const feedEntries = await db
      .select({
        id: activities.id,
        type: activities.type,
        handle: creators.handle,
        previousRank: activities.previousRank,
        newRank: activities.newRank,
        amountCents: activities.amountCents,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .innerJoin(creators, eq(creators.id, activities.creatorId))
      .where(and(eq(activities.seasonId, seasonId)))
      .orderBy(desc(activities.id))
      .limit(10); // Only need the most recent for the live ticker

    const activityEntries: ActivityFeedPayload['entries'] = feedEntries.map((e) => ({
      id: e.id,
      type: e.type as 'bid' | 'rank_change' | 'joined_board',
      handle: e.handle,
      previousRank: e.previousRank,
      newRank: e.newRank,
      amountCents: e.amountCents,
      createdAt: e.createdAt.toISOString(),
    }));

    await publishBoardEvent(slug, {
      type: 'activity',
      entries: activityEntries,
    });
  } catch (err) {
    console.error(`[sse] publishActivityFeed failed slug=${slug}:`, err);
  }
}
