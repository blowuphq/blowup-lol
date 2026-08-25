import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { leaderboardKey, redis } from '../src/lib/redis.js';
import { recordFakeBid } from '../src/features/bidding/pipeline.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';
import { reconcileAllActive, reconcileSeason } from '../src/features/leaderboard/reconcile.js';
import { categories, seasons } from '../src/db/schema.js';

/**
 * Phase 3.5 / R1+R2 tests: the reconciler detects and repairs Redis drift
 * against Postgres truth within ONE run — missing members (the R1 crash
 * window), drifted scores (R2 fail-open writes), and stale members.
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

/** Seed a board and return creatorIds keyed by handle. */
async function seedBoard(ctx: { slug: string }, handles: string[]) {
  const byHandle: Record<string, string> = {};
  for (let i = 0; i < handles.length; i++) {
    const r = await recordFakeBid({
      categorySlug: ctx.slug,
      handle: handles[i],
      amountCents: 2500,
    });
    byHandle[handles[i]] = r.creatorId;
  }
  return byHandle;
}

describe('verifyLeaderboard reconciler', () => {
  it('reports a healthy projection with zero repairs', async () => {
    const ctx = await mkActiveSeason();
    await seedBoard(ctx, ['@a', '@b']);

    const report = await reconcileSeason(ctx.slug);
    expect(report.healthyBefore).toBe(true);
    expect(report.repairs).toEqual([]);
    expect(report.applied).toBe(0);
    expect(report.healthyAfter).toBe(true);
  });

  it('detects and repairs corruption within ONE run (DoD #1)', async () => {
    const ctx = await mkActiveSeason();
    const ids = await seedBoard(ctx, ['@victim', '@vanish', '@bystander']);
    const key = leaderboardKey(ctx.slug, ctx.seasonId);

    // Corrupt all three ways at once:
    //   drifted — a real member carries a wrong score
    await redis.zadd(key, 99.5, ids['@victim']);
    //   stale — a member PG does not know (SSE must never broadcast this)
    await redis.zadd(key, 4.2, 'ghost-creator-id');
    //   missing — the R1 crash-window signature: PG row, no ZSET member
    await redis.zrem(key, ids['@vanish']);

    const report = await reconcileSeason(ctx.slug);
    expect(report.healthyBefore).toBe(false);
    expect(new Set(report.repairs.map((r) => r.kind))).toEqual(
      new Set(['drifted', 'stale', 'missing']),
    );
    expect(report.applied).toBe(3);
    expect(report.failed).toBe(0);

    // Verified repaired by re-read inside the same run...
    expect(report.healthyAfter).toBe(true);
    // ...and independently by the Phase 2 verifier.
    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);
    expect(v.redis.some((e) => e.creatorId === 'ghost-creator-id')).toBe(false);
  });

  it('repairs a fully wiped ZSET (worst-case R1)', async () => {
    const ctx = await mkActiveSeason();
    const ids = await seedBoard(ctx, ['@wiped1', '@wiped2']);
    await redis.del(leaderboardKey(ctx.slug, ctx.seasonId));

    const report = await reconcileSeason(ctx.slug);
    expect(report.repairs.filter((r) => r.kind === 'missing')).toHaveLength(2);
    expect(report.healthyAfter).toBe(true);

    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);
    expect(v.redis.map((e) => e.creatorId).sort()).toEqual(
      Object.values(ids).sort(),
    );
  });

  it('reconcileAllActive covers every active season independently', async () => {
    const ctxA = await mkActiveSeason();
    const ctxB = await mkActiveSeason();
    await seedBoard(ctxA, ['@season-a']);
    await seedBoard(ctxB, ['@season-b']);

    const reports = await reconcileAllActive();
    expect(reports.map((r) => r.slug).sort()).toEqual([ctxA.slug, ctxB.slug].sort());
    expect(reports.every((r) => r.healthyAfter && !r.error)).toBe(true);

    // Drift in one season is isolated; the other still reports healthy.
    await redis.zadd(leaderboardKey(ctxB.slug, ctxB.seasonId), 77.7, 'ghost-b');

    const reports2 = await reconcileAllActive().then((rs) =>
      Object.fromEntries(rs.map((r) => [r.slug, r])),
    );
    expect(reports2[ctxA.slug].healthyBefore).toBe(true);
    expect(reports2[ctxB.slug].healthyBefore).toBe(false);
    expect(reports2[ctxB.slug].healthyAfter).toBe(true);
  });
});
