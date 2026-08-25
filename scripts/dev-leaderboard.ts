import 'dotenv/config';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';
import { assertLocalEnv } from '../src/lib/env-guard.js';
import { pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

/**
 * DEV-ONLY (Phase 2): read the leaderboard back from Redis (ZREVRANGE) and
 * compare it against an independent Postgres computation.
 *
 *   npm run dev:leaderboard -- <categorySlug>
 *
 * Exits 1 on mismatch — usable as a smoke check in scripts/CI later.
 */

function money(cents: string | number): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

async function main(): Promise<void> {
  assertLocalEnv(); // refuses prod-pointing env before any query (see src/lib/env-guard.ts)
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: tsx scripts/dev-leaderboard.ts <categorySlug>');
    process.exitCode = 1;
    return;
  }

  const result = await verifyLeaderboard(slug);
  const handleByCreator = new Map(result.postgres.map((p) => [p.creatorId, p.handle]));

  console.log(`\nLeaderboard '${result.slug}' (season ${result.seasonId})\n`);
  console.log('Redis projection (ZREVRANGE blowup:lb:*):');
  result.redis.forEach((e, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${handleByCreator.get(e.creatorId) ?? e.creatorId}  score=${e.score}`,
    );
  });
  if (result.redis.length === 0) console.log('  (empty)');

  console.log('\nPostgres truth (ORDER BY score DESC, first_bid ASC, id):');
  result.postgres.forEach((e) => {
    console.log(
      `  ${String(e.rank).padStart(2)}. ${e.handle.padEnd(14)} score=${e.score.padEnd(10)} total=${money(e.bidTotalCents)} firstBid=${e.firstBidAt ?? '-'}`,
    );
  });
  if (result.postgres.length === 0) console.log('  (empty)');

  console.log(`\nMATCH: ${result.match ? 'YES — Redis agrees with Postgres' : 'NO'}`);
  for (const reason of result.reasons) console.log(`  ! ${reason}`);
  if (!result.match) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('verification failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect(); // CLI exit: the cached singleton otherwise holds the event loop open
    pool.end();
  });
