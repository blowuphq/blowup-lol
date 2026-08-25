import { eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns, creators } from '../../db/schema.js';
import { getRedisBoard, getPostgresBoard } from './read.js';
import { getActiveSeason } from '../../lib/redis.js';

/**
 * Board read path for the public page (architecture §6 "Cached vs always-
 * Postgres" + §7.6): Redis is the fast path and owns ORDER (ZREVRANGE over
 * the tiebreak-folded scores); Postgres only DECORATES (handles, avatars,
 * subscriber counts, totals) and circuit-breaks as the full ordering
 * fallback when Redis errors. A degraded board is flagged so the page can
 * show the "delayed" banner instead of silently pretending freshness.
 */

export interface BoardRow {
  creatorId: string;
  rank: number;
  /** Raw formula output rounded to 4dp — exactly what PG stores / the page displays. */
  score: number;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  bidTotalCents: number;
  uniqueClicks: number;
  /**
   * Rank change today (UTC): dayStartRank − currentRank, positive = moved up.
   * Day-start rank = previous_rank of the creator's FIRST activity row today.
   * null ⇒ first appeared on the board today ("new"); undefined never occurs.
   */
  dayDelta: number | null;
}

export interface BoardSnapshot {
  slug: string;
  categoryName: string;
  seasonId: string;
  /** ISO string — crosses the RSC serialization boundary verbatim. */
  seasonEndsAt: string;
  rows: BoardRow[];
  source: 'redis' | 'postgres';
}

interface CreatorMeta {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  bidTotalCents: number;
  uniqueClicks: number;
}

/** Season-scoped decoration map — boards are tiny at V1 scale, one query. */
async function seasonCreatorMeta(seasonId: string): Promise<Map<string, CreatorMeta>> {
  const rows = await db
    .select({
      creatorId: campaigns.creatorId,
      handle: creators.handle,
      name: creators.name,
      avatarUrl: creators.avatarUrl,
      subscriberCount: creators.subscriberCount,
      bidTotalCents: campaigns.bidTotalCents,
      uniqueClicks: campaigns.uniqueClicks,
    })
    .from(campaigns)
    .innerJoin(creators, eq(creators.id, campaigns.creatorId))
    .where(eq(campaigns.seasonId, seasonId));

  const map = new Map<string, CreatorMeta>();
  for (const r of rows) {
    map.set(r.creatorId, {
      handle: r.handle,
      name: r.name,
      avatarUrl: r.avatarUrl,
      subscriberCount: r.subscriberCount == null ? null : Number(r.subscriberCount),
      bidTotalCents: Number(r.bidTotalCents),
      uniqueClicks: Number(r.uniqueClicks),
    });
  }
  return map;
}

/** creatorId -> day-start rank (number), or null if they joined today. */
async function dayStartRanks(seasonId: string): Promise<Map<string, number | null>> {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (a.creator_id)
           a.creator_id::text   AS "creatorId",
           a.previous_rank      AS "dayStartRank"
    FROM activities a
    WHERE a.season_id = ${seasonId}
      AND a.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ORDER BY a.creator_id, a.created_at ASC, a.id ASC
  `);
  const map = new Map<string, number | null>();
  for (const row of res.rows as { creatorId: string; dayStartRank: number | null }[]) {
    map.set(row.creatorId, row.dayStartRank);
  }
  return map;
}

function buildRows(
  ordered: { creatorId: string; rawScore: number }[],
  meta: Map<string, CreatorMeta>,
  dayStarts: Map<string, number | null>,
): BoardRow[] {
  return ordered.map((entry, i) => {
    const m = meta.get(entry.creatorId);
    const rank = i + 1;
    const dayStart = dayStarts.get(entry.creatorId);
    return {
      creatorId: entry.creatorId,
      rank,
      score: Number(entry.rawScore.toFixed(4)),
      handle: m?.handle ?? '(unknown)',
      name: m?.name ?? null,
      avatarUrl: m?.avatarUrl ?? null,
      subscriberCount: m?.subscriberCount ?? null,
      bidTotalCents: m?.bidTotalCents ?? 0,
      uniqueClicks: m?.uniqueClicks ?? 0,
      dayDelta: dayStart === undefined ? 0 : dayStart === null ? null : dayStart - rank,
    };
  });
}

/**
 * Load the live board. Redis errors degrade to the PG ordering (§7.6) —
 * never throw into the page render for a read-path problem.
 */
export async function loadBoard(slug: string): Promise<BoardSnapshot> {
  const { category, season } = await getActiveSeason(slug);

  try {
    const { entries } = await getRedisBoard(slug);
    const [meta, dayStarts] = await Promise.all([
      seasonCreatorMeta(season.id),
      dayStartRanks(season.id),
    ]);
    return {
      slug,
      categoryName: category.name,
      seasonId: season.id,
      seasonEndsAt: season.endsAt.toISOString(),
      rows: buildRows(
        entries.map((e) => ({ creatorId: e.creatorId, rawScore: e.score })),
        meta,
        dayStarts,
      ),
      source: 'redis',
    };
  } catch (err) {
    console.warn(`[board] Redis fast path failed for '${slug}', circuit-breaking to PG:`, err);
    const pg = await getPostgresBoard(slug);
    const [meta, dayStarts] = await Promise.all([
      seasonCreatorMeta(pg.seasonId),
      dayStartRanks(pg.seasonId),
    ]);
    return {
      slug,
      categoryName: category.name,
      seasonId: pg.seasonId,
      seasonEndsAt: season.endsAt.toISOString(),
      rows: buildRows(
        pg.entries.map((e) => ({
          creatorId: e.creatorId,
          rawScore: Number(e.score), // raw numeric(14,4) straight from PG
        })),
        meta,
        dayStarts,
      ),
      source: 'postgres',
    };
  }
}
