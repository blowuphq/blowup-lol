import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { redis, seasonPointerKey } from '../src/lib/redis.js';
import { computeScore } from '../src/lib/rank-formula.js';
import { recordFakeBid } from '../src/features/bidding/pipeline.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';
import { listSeasonFeed } from '../src/features/activity/queries.js';
import { categories, seasons } from '../src/db/schema.js';

/**
 * Phase 2 pipeline tests: fake paid bids drive the full
 * Bid -> SUM(total) -> score -> rank -> activity -> Redis projection flow.
 * Postgres is the source of truth; Redis must agree with it.
 */

const TRUNCATE = `TRUNCATE season_results, activities, clicks, bids, campaigns, seasons, creators, webhook_events, categories RESTART IDENTITY CASCADE`;

async function flushProjection(): Promise<void> {
  const keys = await redis.keys('blowup:*');
  if (keys.length > 0) await redis.del(...keys);
}

beforeEach(async () => {
  await db.execute(sql.raw(TRUNCATE));
  await flushProjection();
});

afterAll(async () => {
  await db.execute(sql.raw(TRUNCATE));
  await flushProjection();
  redis.disconnect();
  await pool.end();
});

const slug = () => `t${randomUUID().replaceAll('-', '').slice(0, 10)}`;

/** Assert Redis projection equals PG truth, surfacing WHY on mismatch. */
async function expectAgreement(categorySlug: string): Promise<void> {
  const v = await verifyLeaderboard(categorySlug);
  if (!v.match) {
    throw new Error(
      `Redis/PG mismatch: ${v.reasons.join(' | ')}\nredis=${JSON.stringify(v.redis)}\npg=${JSON.stringify(
        v.postgres.map((p) => [p.handle, p.score, p.rank]),
      )}`,
    );
  }
}

async function mkActiveSeason(): Promise<{ slug: string; seasonId: string }> {
  const s = slug();
  const [cat] = await db.insert(categories).values({ slug: s, name: s }).returning();
  const [season] = await db
    .insert(seasons)
    .values({
      categoryId: cat.id,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 7 * 24 * 3600_000),
      status: 'active',
    })
    .returning();
  return { slug: s, seasonId: season.id };
}

describe('ranking formula (public, log-weighted 85/15)', () => {
  it('computes the documented values', () => {
    // 0.85 * ln(1 + $25) = 0.85 * ln(26) = 2.769382... -> 2.7694
    expect(computeScore({ bidTotalCents: 2500, uniqueClicks: 0 })).toBeCloseTo(2.7694, 4);
    // 0.85*ln(1+$100) + 0.15*ln(1+10 clicks) = 3.922852 + 0.359684 = 4.282536 -> 4.2825
    expect(computeScore({ bidTotalCents: 10000, uniqueClicks: 10 })).toBeCloseTo(4.2825, 4);
  });

  it('is monotonic in money', () => {
    const lower = computeScore({ bidTotalCents: 500, uniqueClicks: 0 });
    const higher = computeScore({ bidTotalCents: 50000, uniqueClicks: 0 });
    expect(higher).toBeGreaterThan(lower);
  });
});

describe('end-to-end pipeline: 5 fake bids across 3 creators', () => {
  async function runScenario(): Promise<{ slug: string; seasonId: string }> {
    const ctx = await mkActiveSeason();
    // totals after each step: A=$5, A=$25, B=$500, C=$100, B=$505
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@alice', amountCents: 500 });
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@alice', amountCents: 2000 });
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@bob', amountCents: 50_000 });
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@carol', amountCents: 10_000 });
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@bob', name: 'Bob', amountCents: 500 });
    return ctx;
  }

  it('orders the leaderboard by derived score (money-heavy first)', async () => {
    const ctx = await runScenario();

    const verification = await verifyLeaderboard(ctx.slug);
    expect(verification.match, verification.reasons.join(' | ')).toBe(true);

    const order = verification.postgres.map((e) => e.handle);
    // scores: bob $505=5.2926 > carol $100=3.9229 > alice $25=2.7694
    expect(order).toEqual(['@bob', '@carol', '@alice']);
  });

  it('writes one Activity row per bid with correct previousRank/newRank', async () => {
    const ctx = await runScenario();

    const feedDesc = await listSeasonFeed(ctx.seasonId, 50);
    const feed = [...feedDesc].reverse(); // chronological

    expect(feed.map((f) => f.type)).toEqual([
      'joined_board', // @alice joins at rank 1
      'bid', // @alice tops up, stays rank 1
      'joined_board', // @bob joins at rank 1 (@alice silently pushed to 2)
      'joined_board', // @carol joins at rank 2
      'bid', // @bob tops up, stays rank 1
    ]);
    expect(feed.map((f) => [f.previousRank, f.newRank])).toEqual([
      [null, 1],
      [1, 1],
      [null, 1],
      [null, 2],
      [1, 1],
    ]);
    expect(feed.every((f) => f.amountCents !== null)).toBe(true);
  });

  it('derives campaign totals from summed bids, never incremented blindly', async () => {
    const ctx = await runScenario();

    const res = await db.execute(
      sql`SELECT c.bid_total_cents::text AS total, (SELECT COALESCE(SUM(b.amount_cents),0)::text FROM bids b WHERE b.campaign_id = c.id AND b.payment_status='succeeded') AS sum_bids FROM campaigns c WHERE c.season_id = ${ctx.seasonId}`,
    );
    for (const row of res.rows as { total: string; sum_bids: string }[]) {
      expect(row.total).toBe(row.sum_bids);
    }
  });
});

describe('concurrent bids race for the same season', () => {
  it('serializes via advisory lock: distinct ranks, coherent projection', async () => {
    const ctx = await mkActiveSeason();

    const [r1, r2] = await Promise.all([
      recordFakeBid({ categorySlug: ctx.slug, handle: '@racer1', amountCents: 50_000 }),
      recordFakeBid({ categorySlug: ctx.slug, handle: '@racer2', amountCents: 2500 }),
    ]);

    // Both committed; ranks distinct; whale ahead.
    expect(r1.newRank).not.toBe(r2.newRank);
    expect(new Set([r1.newRank, r2.newRank]).size).toBe(2);

    const ranks = await db.execute(
      sql`SELECT rank FROM campaigns WHERE season_id = ${ctx.seasonId} AND rank IS NOT NULL`,
    );
    const rankVals = (ranks.rows as { rank: number }[]).map((r) => r.rank);
    expect(new Set(rankVals).size).toBe(rankVals.length); // no duplicate ranks

    await expectAgreement(ctx.slug);
  });

  it('keeps activity history coherent under the race', async () => {
    const ctx = await mkActiveSeason();

    await Promise.all([
      recordFakeBid({ categorySlug: ctx.slug, handle: '@ra', amountCents: 10_000 }),
      recordFakeBid({ categorySlug: ctx.slug, handle: '@rb', amountCents: 20_000 }),
      recordFakeBid({ categorySlug: ctx.slug, handle: '@rc', amountCents: 30_000 }),
    ]);

    const feedDesc = await listSeasonFeed(ctx.seasonId, 50);
    expect(feedDesc).toHaveLength(3);
    // Every joiner reports its rank at ITS OWN commit time; creators pushed
    // down by later bids update silently (no activity) by design — so the set
    // of REPORTED ranks is not necessarily {1,2,3}, but must stay within it.
    expect(feedDesc.every((f) => f.previousRank === null)).toBe(true);
    for (const f of feedDesc) {
      expect([1, 2, 3]).toContain(f.newRank);
    }

    // The authoritative campaigns table, however, must hold exactly {1,2,3}.
    const ranks = await db.execute(
      sql`SELECT rank FROM campaigns WHERE season_id = ${ctx.seasonId} AND rank IS NOT NULL`,
    );
    expect(new Set((ranks.rows as { rank: number }[]).map((r) => r.rank))).toEqual(
      new Set([1, 2, 3]),
    );
  });
});

describe('projection robustness', () => {
  it('repairs a poisoned/wrong season pointer from Postgres truth', async () => {
    const ctx = await mkActiveSeason();

    // Poison the pointer with a random id — reads through it must fall back to PG.
    await redis.set(seasonPointerKey(ctx.slug), randomUUID());

    const result = await recordFakeBid({
      categorySlug: ctx.slug,
      handle: '@pointer',
      amountCents: 2500,
    });
    expect(result.newRank).toBe(1);

    const repaired = await redis.get(seasonPointerKey(ctx.slug));
    expect(repaired).toBe(ctx.seasonId);
  });

  it('rejects out-of-bounds amounts before touching any table', async () => {
    const ctx = await mkActiveSeason();

    await expect(
      recordFakeBid({ categorySlug: ctx.slug, handle: '@cheap', amountCents: 499 }),
    ).rejects.toThrow(/between/);
    await expect(
      recordFakeBid({ categorySlug: ctx.slug, handle: '@whale', amountCents: 1_000_001 }),
    ).rejects.toThrow(/between/);

    const counts = await db.execute(
      sql`SELECT (SELECT count(*) FROM creators) AS creators, (SELECT count(*) FROM bids) AS bids`,
    );
    const row = counts.rows[0] as { creators: string; bids: string };
    expect(row.creators).toBe('0');
    expect(row.bids).toBe('0');
  });
});
