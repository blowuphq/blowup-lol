import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { toZsetScore } from '../../lib/rank-formula.js';
import {
  getActiveSeason,
  leaderboardKey,
  redis,
  safeZadd,
  safeZrem,
} from '../../lib/redis.js';
import { categories, seasons } from '../../db/schema.js';
import { getPostgresBoard, SCORE_TOLERANCE } from './read.js';

/**
 * The leaderboard reconciler (R1/R2 mitigation, architecture §6): diff each
 * active season's Redis ZSET against what Postgres ALONE computes, and repair
 * drift with targeted ZADD/ZREMs. This closes the crash window between a PG
 * commit and its post-commit ZADD (R1) and the silent drift safeZadd's
 * fail-open design allows (R2) — without waiting for the next bid on that
 * creator to paper over it.
 *
 * Concurrency contract (safe to run next to settlement, always):
 *  - Read-only toward Postgres and holds NO advisory lock. A season read may
 *    observe any committed state; whatever snapshot we get, repairs derived
 *    from it are values PG has already declared true.
 *  - Repairs are idempotent Redis writes of committed truth. A settlement
 *    racing this job re-writes the same member with identical-or-newer data;
 *    worst case is one transiently stale entry that the next 5-minute cycle
 *    heals. Redis repair never touches money truth (§7.1).
 *  - Full-ZSET diff rather than §6's top-50 sketch: boards are tiny at V1
 *    scale, and stale members (e.g. after a refunded/rolled-back edge) must
 *    not linger where SSE would broadcast them.
 */

export interface ReconcileRepair {
  creatorId: string;
  kind:
    | 'missing' // in PG, absent from the ZSET (the R1 crash-window signature)
    | 'drifted' // in both, but the ZSET score disagrees with folded PG truth
    | 'stale'; // in the ZSET, absent from PG
  redisScore?: number;
  expectedScore?: number;
}

export interface SeasonReconcileReport {
  slug: string;
  seasonId: string;
  key: string;
  pgMembers: number;
  redisMembers: number;
  repairs: ReconcileRepair[];
  applied: number;
  failed: number;
  healthyBefore: boolean;
  /** Verified by re-reading the ZSET after repairs within the same run. */
  healthyAfter: boolean;
  /** Set when the comparison itself failed (Redis outage etc.) — nothing was repaired. */
  error?: string;
}

/** Expected ZSET state for an active season: creatorId -> tiebreak-adjusted score. */
async function expectedProjection(slug: string): Promise<{
  seasonId: string;
  key: string;
  expected: Map<string, number>;
}> {
  const [{ season }, pgBoard] = await Promise.all([
    getActiveSeason(slug),
    getPostgresBoard(slug),
  ]);
  const key = leaderboardKey(slug, season.id);
  const expected = new Map<string, number>();
  for (const e of pgBoard.entries) {
    expected.set(e.creatorId, toZsetScore(Number(e.score), e.firstBidOrdinal));
  }
  return { seasonId: season.id, key, expected };
}

async function readZset(key: string): Promise<Map<string, number>> {
  const flat = await redis.zrange(key, 0, -1, 'WITHSCORES');
  const actual = new Map<string, number>();
  for (let i = 0; i < flat.length; i += 2) actual.set(flat[i], Number(flat[i + 1]));
  return actual;
}

function diff(
  expected: Map<string, number>,
  actual: Map<string, number>,
): ReconcileRepair[] {
  const repairs: ReconcileRepair[] = [];
  for (const [creatorId, expectedScore] of expected) {
    const redisScore = actual.get(creatorId);
    if (redisScore === undefined) {
      repairs.push({ creatorId, kind: 'missing', expectedScore });
    } else if (Math.abs(redisScore - expectedScore) > SCORE_TOLERANCE) {
      repairs.push({ creatorId, kind: 'drifted', redisScore, expectedScore });
    }
  }
  for (const [creatorId, redisScore] of actual) {
    if (!expected.has(creatorId)) {
      repairs.push({ creatorId, kind: 'stale', redisScore });
    }
  }
  return repairs;
}

async function agreesWithTruth(
  key: string,
  expected: Map<string, number>,
): Promise<boolean> {
  const actual = await readZset(key);
  if (actual.size !== expected.size) return false;
  for (const [member, score] of expected) {
    const redisScore = actual.get(member);
    if (redisScore === undefined || Math.abs(redisScore - score) > SCORE_TOLERANCE) {
      return false;
    }
  }
  return true;
}

/** Reconcile one category's active season. Never throws into batch callers. */
export async function reconcileSeason(slug: string): Promise<SeasonReconcileReport> {
  const base = { slug } as SeasonReconcileReport;
  try {
    const { seasonId, key, expected } = await expectedProjection(slug);
    const actual = await readZset(key);
    const repairs = diff(expected, actual);

    let applied = 0;
    let failed = 0;
    for (const r of repairs) {
      const ok =
        r.kind === 'stale'
          ? await safeZrem(key, r.creatorId)
          : await safeZadd(key, r.expectedScore!, r.creatorId);
      if (ok) applied++;
      else failed++;
    }

    const healthyAfter =
      failed === 0 && (await agreesWithTruth(key, expected));

    return {
      ...base,
      seasonId,
      key,
      pgMembers: expected.size,
      redisMembers: actual.size,
      repairs,
      applied,
      failed,
      healthyBefore: repairs.length === 0,
      healthyAfter,
    };
  } catch (err) {
    return {
      ...base,
      seasonId: 'unknown',
      key: 'unknown',
      pgMembers: 0,
      redisMembers: 0,
      repairs: [],
      applied: 0,
      failed: 0,
      healthyBefore: false,
      healthyAfter: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** All categories with an active season right now. */
export async function listActiveSeasonSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: categories.slug })
    .from(seasons)
    .innerJoin(categories, eq(categories.id, seasons.categoryId))
    .where(eq(seasons.status, 'active'));
  return rows.map((r) => r.slug);
}

/** Reconcile every active season; per-season failures are isolated into reports. */
export async function reconcileAllActive(): Promise<SeasonReconcileReport[]> {
  const slugs = await listActiveSeasonSlugs();
  const reports: SeasonReconcileReport[] = [];
  for (const slug of slugs) {
    reports.push(await reconcileSeason(slug));
  }
  return reports;
}
