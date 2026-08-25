import { sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { toZsetScore } from '../../lib/rank-formula.js';
import { getActiveSeason, leaderboardKey, redis } from '../../lib/redis.js';

/**
 * Leaderboard reads (architecture §6): Redis is the fast path, Postgres the
 * source of truth. verifyLeaderboard() recomputes the expected ranking
 * independently from PG and compares — this is the Phase 2 proof that the
 * projection agrees with truth. Since R3, the ZSET carries tiebreak-adjusted
 * scores (score − ε·firstBidOrdinal), so the expected value is folded the
 * same way before comparing.
 */

/** Float64 slack for comparing projected vs computed ZSET scores. */
export const SCORE_TOLERANCE = 1e-9;

export interface RedisBoardEntry {
  creatorId: string;
  score: number;
}

export interface PostgresBoardEntry {
  rank: number;
  creatorId: string;
  handle: string;
  name: string | null;
  score: string;
  bidTotalCents: string;
  /** Raw from db.execute: drizzle's parser leaves timestamptz as a string. */
  firstBidAt: string | null;
  /** Position in the season-wide (first_bid ASC NULLS LAST, id) ordering — the R3 fold input. */
  firstBidOrdinal: number;
}

export async function getRedisBoard(slug: string): Promise<{
  seasonId: string;
  key: string;
  entries: RedisBoardEntry[];
}> {
  const { season } = await getActiveSeason(slug);
  const key = leaderboardKey(slug, season.id);
  // ZREVRANGE WITHSCORES -> flat [member, score, member, score, ...], highest score first
  const flat = await redis.zrevrange(key, 0, -1, 'WITHSCORES');
  const entries: RedisBoardEntry[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    entries.push({ creatorId: flat[i], score: Number(flat[i + 1]) });
  }
  return { seasonId: season.id, key, entries };
}

export async function getPostgresBoard(slug: string): Promise<{
  seasonId: string;
  entries: PostgresBoardEntry[];
}> {
  const { season } = await getActiveSeason(slug);
  const res = await db.execute(sql`
    SELECT c.rank,
           c.creator_id            AS "creatorId",
           cr.handle,
           cr.name,
           c.score::text           AS score,
           c.bid_total_cents::text AS "bidTotalCents",
           fb.first_bid_at         AS "firstBidAt",
           ROW_NUMBER() OVER (
             ORDER BY fb.first_bid_at ASC NULLS LAST, c.id ASC
           )::int                  AS "firstBidOrdinal"
    FROM campaigns c
    JOIN creators cr ON cr.id = c.creator_id
    LEFT JOIN LATERAL (
      SELECT MIN(b.created_at) AS first_bid_at
      FROM bids b
      WHERE b.campaign_id = c.id AND b.payment_status = 'succeeded'
    ) fb ON TRUE
    WHERE c.season_id = ${season.id}
    ORDER BY c.score DESC, fb.first_bid_at ASC NULLS LAST, c.id ASC
  `);
  return {
    seasonId: season.id,
    entries: res.rows as unknown as PostgresBoardEntry[],
  };
}

export interface VerificationResult {
  slug: string;
  seasonId: string;
  match: boolean;
  reasons: string[];
  redis: RedisBoardEntry[];
  postgres: PostgresBoardEntry[];
}

/** The DoD #2 proof: does the Redis projection equal what PG computes alone? */
export async function verifyLeaderboard(slug: string): Promise<VerificationResult> {
  const [{ season: redisSeason }, redisBoard, pgBoard] = await Promise.all([
    getActiveSeason(slug),
    getRedisBoard(slug),
    getPostgresBoard(slug),
  ]);

  const reasons: string[] = [];
  if (redisSeason.id !== pgBoard.seasonId) {
    reasons.push(`season mismatch: redis=${redisSeason.id} pg=${pgBoard.seasonId}`);
  }

  const pgCreators = pgBoard.entries.map((e) => e.creatorId);
  const redisCreators = redisBoard.entries.map((e) => e.creatorId);

  if (pgCreators.length !== redisCreators.length) {
    reasons.push(`member count differs: redis=${redisCreators.length} pg=${pgCreators.length}`);
  }

  for (let i = 0; i < Math.min(pgCreators.length, redisCreators.length); i++) {
    if (pgCreators[i] !== redisCreators[i]) {
      reasons.push(
        `position ${i + 1} differs: redis=${redisCreators[i]} pg=${pgCreators[i]}`,
      );
      break;
    }
  }

  // Scores must agree within float-print precision of numeric(14,4) — compared
  // against the tiebreak-adjusted expectation (R3), since the ZSET no longer
  // stores raw scores.
  for (let i = 0; i < Math.min(pgBoard.entries.length, redisBoard.entries.length); i++) {
    const pgEntry = pgBoard.entries[i];
    const expected = toZsetScore(Number(pgEntry.score), pgEntry.firstBidOrdinal);
    if (Math.abs(expected - redisBoard.entries[i].score) > SCORE_TOLERANCE) {
      reasons.push(
        `score drift at position ${i + 1}: redis=${redisBoard.entries[i].score} pg(raw)=${pgEntry.score}`,
      );
      break;
    }
  }

  return {
    slug,
    seasonId: pgBoard.seasonId,
    match: reasons.length === 0,
    reasons,
    redis: redisBoard.entries,
    postgres: pgBoard.entries,
  };
}
