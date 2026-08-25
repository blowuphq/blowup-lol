import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { computeScore, TIEBREAK_EPSILON, toZsetScore } from '../src/lib/rank-formula.js';
import { recordFakeBid } from '../src/features/bidding/pipeline.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';
import { categories, seasons } from '../src/db/schema.js';

/**
 * Phase 3.5 / R3 tests: the Redis projection folds the PG tiebreak into its
 * score (score − ε·firstBidOrdinal) so byte-equal raw scores order
 * identically in ZREVRANGE and in Postgres.
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

describe('tiebreak fold math (pure)', () => {
  it('never lets the fold reorder two DIFFERENT rounded scores', () => {
    // Worst case: minimum possible gap between two numeric(14,4) scores,
    // with maximally adverse ordinals (worse score gets the better ordinal).
    const better = 2.7694;
    const worse = 2.7695;
    const maxOrdinal = 1_000_000;
    expect(toZsetScore(worse, 1)).toBeGreaterThan(toZsetScore(better, maxOrdinal));
    // And the bound that guarantees it holds at any realistic season size:
    // total adjustment ≤ half the minimum distinct-score gap.
    expect(TIEBREAK_EPSILON * maxOrdinal).toBeLessThanOrEqual(0.5 * 1e-4);
  });

  it('orders equal raw scores by firstBidOrdinal ascending', () => {
    const s = computeScore({ bidTotalCents: 2500, uniqueClicks: 0 });
    const first = toZsetScore(s, 1);
    const second = toZsetScore(s, 2);
    expect(first).toBeGreaterThan(second);
    // Steps are exactly ε apart and stay far above float64 ulp at score
    // magnitude ~10 (~1.8e-15).
    expect(second - toZsetScore(s, 3)).toBeCloseTo(TIEBREAK_EPSILON, 15);
  });
});

describe('identical raw scores: PG and ZREVRANGE agree (R3 acceptance)', () => {
  async function tiedPair(firstHandle: string, secondHandle: string) {
    const ctx = await mkActiveSeason();
    await recordFakeBid({ categorySlug: ctx.slug, handle: firstHandle, amountCents: 2500 });
    await recordFakeBid({ categorySlug: ctx.slug, handle: secondHandle, amountCents: 2500 });
    return ctx;
  }

  it('earlier first bid leads in BOTH stores', async () => {
    const ctx = await tiedPair('@early', '@late');

    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);

    // The tie is genuine: identical raw scores in PG...
    const [pgFirst, pgSecond] = v.postgres;
    expect(Number(pgFirst.score)).toBe(Number(pgSecond.score));
    expect(pgFirst.handle).toBe('@early');

    // ...yet the projection distinguishes them by folded score, earlier wins.
    const [rFirst, rSecond] = v.redis;
    expect(rFirst.creatorId).toBe(pgFirst.creatorId);
    expect(rFirst.score).toBeGreaterThan(rSecond.score);
    expect(Math.abs(rFirst.score - toZsetScore(Number(pgFirst.score), 1))).toBeLessThanOrEqual(
      1e-9,
    );
    expect(Math.abs(rSecond.score - toZsetScore(Number(pgSecond.score), 2))).toBeLessThanOrEqual(
      1e-9,
    );
  });

  it('tie direction follows bid time, not UUID luck (reversed order)', async () => {
    // '@zzz' bids FIRST although it sorts last lexicographically — if Redis
    // were still tie-breaking by member UUID it would misorder this pair.
    const ctx = await tiedPair('@zzz', '@aaa');

    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);

    expect(v.postgres[0].handle).toBe('@zzz');
    expect(v.redis[0].creatorId).toBe(v.postgres[0].creatorId);
    expect(v.postgres[1].handle).toBe('@aaa');
    expect(v.redis[1].creatorId).toBe(v.postgres[1].creatorId);
  });

  it('keeps ordinals stable when a third creator joins later', async () => {
    const ctx = await tiedPair('@pioneer', '@follower');
    await recordFakeBid({ categorySlug: ctx.slug, handle: '@newcomer', amountCents: 2500 });

    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);

    // All three tied; order must remain pure first-bid order with @newcomer
    // appended last — proof that late joins never shift existing ordinals.
    expect(v.postgres.map((e) => e.handle)).toEqual(['@pioneer', '@follower', '@newcomer']);
    expect(v.redis.map((e) => e.creatorId)).toEqual(v.postgres.map((e) => e.creatorId));
    const ordinals = v.postgres.map((e) => e.firstBidOrdinal);
    expect(ordinals).toEqual([1, 2, 3]);
  });
});
