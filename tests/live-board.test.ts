import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { computeScore } from '../src/lib/rank-formula.js';
import { recordFakeBid } from '../src/features/bidding/pipeline.js';
import {
  latestStreamId,
  publishBoardEvent,
  readEventsAfter,
  visitorCount,
  visitorJoined,
  visitorLeft,
} from '../src/lib/sse.js';
import { loadBoard } from '../src/features/leaderboard/board.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';
import { categories, seasons } from '../src/db/schema.js';

/**
 * Phase 4: SSE hub mechanics (replay/cursor semantics, visitor counter),
 * the public board read path (order parity Redis↔PG, displayed-formula
 * accuracy, day-start deltas, PG circuit-break fallback), and the shared
 * rank-delta publish hook that both settlement paths call post-commit.
 */

// Circuit-break test intercepts ONLY getRedisBoard; everything else stays real.
vi.mock('../src/features/leaderboard/read.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/features/leaderboard/read.js')>();
  return { ...actual, getRedisBoard: vi.fn(actual.getRedisBoard) };
});
import { getRedisBoard } from '../src/features/leaderboard/read.js';

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

async function mkActiveSeason(): Promise<{ slug: string }> {
  const s = `t${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const [cat] = await db.insert(categories).values({ slug: s, name: s }).returning();
  await db.insert(seasons).values({
    categoryId: cat.id,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 7 * 24 * 3600_000),
    status: 'active',
  });
  return { slug: s };
}

describe('SSE hub: streams, cursor semantics, Last-Event-ID replay', () => {
  it('delivers published events in order and replays after an explicit Last-Event-ID', async () => {
    const { slug } = await mkActiveSeason();

    const id1 = await publishBoardEvent(slug, {
      type: 'rank_delta',
      entries: [{ creatorId: 'c1', newRank: 1, score: 1, handle: '@a', name: null, avatarUrl: null, subscriberCount: null, bidTotalCents: 5000, uniqueClicks: 0 }],
      activity: { type: 'joined_board', previousRank: null, newRank: 1, amountCents: 5000 },
    });
    const id2 = await publishBoardEvent(slug, {
      type: 'rank_delta',
      entries: [{ creatorId: 'c2', newRank: 2, score: 0.9, handle: '@b', name: null, avatarUrl: null, subscriberCount: null, bidTotalCents: 2500, uniqueClicks: 0 }],
      activity: { type: 'joined_board', previousRank: null, newRank: 2, amountCents: 2500 },
    });
    expect(id1).toMatch(/^\d+-\d+$/);
    expect(id2).toMatch(/^\d+-\d+$/);

    // Full replay ('0-0') sees both, oldest first.
    const all = await readEventsAfter(slug, '0-0', 1_000);
    expect(all.map((e) => e.id)).toEqual([id1, id2]);

    // Reconnect semantics: Last-Event-ID = id1 -> only what came AFTER it.
    const afterFirst = await readEventsAfter(slug, id1!, 1_000);
    expect(afterFirst.map((e) => e.id)).toEqual([id2]);
    expect(afterFirst[0]!.payload.type).toBe('rank_delta');
  }, 20_000);

  it('a fresh connection pins a concrete cursor: backlog hidden, new events still delivered', async () => {
    const { slug } = await mkActiveSeason();
    const preExisting = await publishBoardEvent(slug, { type: 'visitors', count: 1 });

    // What /api/events does for a connect WITHOUT Last-Event-ID:
    const freshCursor = await latestStreamId(slug);
    expect(freshCursor).toBe(preExisting);

    // Events published after the pin arrive; the backlog does not.
    const late = await publishBoardEvent(slug, { type: 'visitors', count: 2 });
    const fresh = await readEventsAfter(slug, freshCursor, 1_000);
    expect(fresh.map((e) => e.id)).toEqual([late]);

    // Empty/absent stream -> cursor '0-0' (full retained replay, harmless).
    expect(await latestStreamId(`no-such-slug-${randomUUID()}`)).toBe('0-0');
  }, 20_000);

  it('MAXLEN keeps the retained stream bounded', async () => {
    const { slug } = await mkActiveSeason();
    for (let i = 0; i < 12; i++) {
      await publishBoardEvent(slug, { type: 'visitors', count: i });
    }
    // Far below the MAXLEN ~500 cap: everything is still retained for replay.
    const replayed = await readEventsAfter(slug, '0-0', 1_000);
    expect(replayed).toHaveLength(12);
  }, 30_000);

  it('visitor counter increments, decrements, and clamps at zero', async () => {
    const { slug } = await mkActiveSeason();
    await redis.del(`blowup:visitors:${slug}`);

    expect(await visitorJoined(slug)).toBe(1);
    expect(await visitorJoined(slug)).toBe(2);
    expect(await visitorCount(slug)).toBe(2);
    await visitorLeft(slug);
    expect(await visitorCount(slug)).toBe(1);
    await visitorLeft(slug);
    expect(await visitorCount(slug)).toBe(0);
    await visitorLeft(slug); // crash-lost DECRs / double-leave must not go negative
    expect(await visitorCount(slug)).toBe(0);
  });
});

describe('public board read path', () => {
  it('orders identically to PG truth, displays exact formula outputs, flags same-day joiners', async () => {
    const { slug } = await mkActiveSeason();
    // C outbids everyone; A and B TIE at $50 (A bid first -> ranks higher); D smallest.
    await recordFakeBid({ categorySlug: slug, handle: '@alpha', amountCents: 5000 });
    await recordFakeBid({ categorySlug: slug, handle: '@beta', amountCents: 5000 });
    await recordFakeBid({ categorySlug: slug, handle: '@charlie', amountCents: 20000 });
    await recordFakeBid({ categorySlug: slug, handle: '@delta', amountCents: 2500 });

    const board = await loadBoard(slug);
    expect(board.source).toBe('redis');

    const verification = await verifyLeaderboard(slug);
    expect(verification.match).toBe(true);

    // Order parity: board == PG truth == Redis projection.
    expect(board.rows.map((r) => r.creatorId)).toEqual(
      verification.postgres.map((p) => p.creatorId),
    );
    expect(board.rows.map((r) => r.handle)).toEqual([
      '@charlie',
      '@alpha',
      '@beta',
      '@delta',
    ]);

    // Displayed score == executed formula == stored numeric(14,4), per row.
    for (const row of board.rows) {
      expect(row.score).toBe(
        computeScore({ bidTotalCents: row.bidTotalCents, uniqueClicks: row.uniqueClicks }),
      );
      const pgRow = verification.postgres.find((p) => p.creatorId === row.creatorId)!;
      expect(row.score).toBe(Number(pgRow.score));
    }

    // Everyone joined today -> every first activity has previous_rank NULL.
    for (const row of board.rows) expect(row.dayDelta).toBeNull();
  });

  it('circuit-breaks to the Postgres ordering when the Redis fast path fails (§7.6)', async () => {
    const { slug } = await mkActiveSeason();
    await recordFakeBid({ categorySlug: slug, handle: '@one', amountCents: 10_000 });
    await recordFakeBid({ categorySlug: slug, handle: '@two', amountCents: 2_500 });

    const healthy = await loadBoard(slug);
    expect(healthy.source).toBe('redis');

    const mockGetRedis = vi.mocked(getRedisBoard);
    mockGetRedis.mockRejectedValueOnce(new Error('simulated redis outage'));

    const degraded = await loadBoard(slug);
    expect(degraded.source).toBe('postgres');
    expect(degraded.rows.map((r) => [r.handle, r.rank, r.score])).toEqual(
      healthy.rows.map((r) => [r.handle, r.rank, r.score]),
    );

    // Subsequent calls fall through to the real implementation again.
    expect((await loadBoard(slug)).source).toBe('redis');
  });

  it('rank-delta publishing fires from the settlement pipeline with absolute state', async () => {
    const { slug } = await mkActiveSeason();
    const result = await recordFakeBid({
      categorySlug: slug,
      handle: '@streamer',
      amountCents: 7_500,
    });

    const events = await readEventsAfter(slug, '0-0', 1_000);
    const deltas = events.filter((e) => e.payload.type === 'rank_delta');
    expect(deltas).toHaveLength(1);

    const delta = deltas[0]!.payload as {
      type: 'rank_delta';
      entries: {
        creatorId: string;
        newRank: number | null;
        score: number;
        handle: string;
        bidTotalCents: number;
      }[];
      activity: { type: string; previousRank: number | null; newRank: number | null; amountCents: number };
    };
    expect(delta.entries).toHaveLength(1);
    expect(delta.entries[0]).toMatchObject({
      creatorId: result.creatorId,
      newRank: result.newRank,
      score: result.score,
      handle: '@streamer',
      bidTotalCents: 7500,
    });
    expect(delta.activity).toMatchObject({
      type: 'joined_board',
      previousRank: null,
      newRank: 1,
      amountCents: 7500,
    });
  });
});
