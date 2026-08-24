import { eq, and } from 'drizzle-orm';
import { REDIS_KEY_PREFIX } from '../config/site.js';
import { db } from './db.js';
import { categories, seasons } from '../db/schema.js';
import { createRedisClient } from './redis-client.js';
import type { RedisClient } from './redis-client.js';

/**
 * Redis access layer (architecture §6).
 *
 * Redis is ONLY a fast-read projection of the leaderboard — Postgres is the
 * source of truth for money and rank. Every write here happens AFTER the
 * Postgres commit; failures are logged, never thrown into the money path.
 *
 * Client note: local/dev runs ioredis against a local redis container. At
 * deploy time Upstash is reached via its Redis-compatible endpoint (or the
 * @upstash/redis REST client) — same key scheme either way. VERIFY at deploy,
 * do not assume (same condition as deviation 3 in docs/phase1-deviations.md).
 */

const globalForRedis = globalThis as unknown as { blowupRedis?: RedisClient };

export const redis: RedisClient =
  globalForRedis.blowupRedis ??
  createRedisClient(process.env.REDIS_URL ?? 'redis://localhost:6379');

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.blowupRedis = redis;
}

/** Active-season pointer: `blowup:season:{slug}` -> seasonId (architecture §6). */
export const seasonPointerKey = (slug: string): string => `${REDIS_KEY_PREFIX}:season:${slug}`;

/** Leaderboard ZSET: `blowup:lb:{slug}:s{seasonId}`, member=creatorId, score=score. */
export const leaderboardKey = (slug: string, seasonId: string): string =>
  `${REDIS_KEY_PREFIX}:lb:${slug}:s${seasonId}`;

export interface SeasonContext {
  category: { id: number; slug: string; name: string };
  season: { id: string; startsAt: Date; endsAt: Date };
}

/**
 * Resolve the active season for a category slug, reading through the Redis
 * pointer with Postgres as source of truth (pointer is validated against PG
 * on every hit and repaired when missing/wrong — architecture §3.A2/§6).
 */
export async function getActiveSeason(slug: string): Promise<SeasonContext> {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.active, true)));
  if (!category) throw new Error(`unknown or inactive category slug: ${slug}`);

  const pointerKey = seasonPointerKey(slug);
  let seasonRow: { id: string; startsAt: Date; endsAt: Date } | undefined;

  try {
    const pointedId = await redis.get(pointerKey);
    if (pointedId) {
      // Pointer content is external state — validate it parameterized, never interpolate.
      const rows = await db
        .select({ id: seasons.id, startsAt: seasons.startsAt, endsAt: seasons.endsAt })
        .from(seasons)
        .where(
          and(
            eq(seasons.id, pointedId),
            eq(seasons.status, 'active'),
            eq(seasons.categoryId, category.id),
          ),
        );
      if (rows[0]) seasonRow = rows[0];
    }
  } catch (err) {
    console.warn('[redis] pointer read failed, falling back to Postgres:', err);
  }

  if (!seasonRow) {
    const found = await db
      .select({ id: seasons.id, startsAt: seasons.startsAt, endsAt: seasons.endsAt })
      .from(seasons)
      .where(and(eq(seasons.categoryId, category.id), eq(seasons.status, 'active')));
    if (!found[0]) throw new Error(`no active season for category '${slug}'`);
    seasonRow = found[0];
    try {
      await redis.set(pointerKey, seasonRow.id);
    } catch (err) {
      console.warn('[redis] pointer write failed (PG fallback already used):', err);
    }
  }

  return {
    category,
    season: { id: seasonRow.id, startsAt: seasonRow.startsAt, endsAt: seasonRow.endsAt },
  };
}

/**
 * Post-commit projection write (architecture §3.B10). Retries once; on failure
 * logs and returns false — the money txn is already committed, and the
 * reconciler (Inngest phase) heals drift. NEVER throws into the caller.
 */
export async function safeZadd(key: string, score: number, member: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await redis.zadd(key, score, member);
      return true;
    } catch (err) {
      console.error(`[redis] ZADD failed (attempt ${attempt}/2) key=${key}:`, err);
    }
  }
  return false;
}
