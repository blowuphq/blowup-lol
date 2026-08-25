import 'dotenv/config';
import { reconcileAllActive, reconcileSeason } from '../src/features/leaderboard/reconcile.js';
import { assertLocalEnv } from '../src/lib/env-guard.js';
import { pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

/**
 * DEV/OPS on-demand trigger for the reconciler (R1/R2, architecture §6).
 * Runs the exact same code path the Inngest 5-minute cron executes,
 * independent of any scheduler:
 *
 *   npm run dev:reconcile             # every active season
 *   npm run dev:reconcile -- <slug>   # one category slug
 *
 * Exits 1 if any season is still unhealthy after repairs.
 */

async function main(): Promise<void> {
  assertLocalEnv(); // refuses prod-pointing env before any query (see src/lib/env-guard.ts)
  const slug = process.argv[2];
  const reports = slug ? [await reconcileSeason(slug)] : await reconcileAllActive();

  let unhealthy = 0;
  for (const r of reports) {
    const flag = r.healthyAfter ? 'OK ' : 'BAD';
    console.log(`${flag} ${r.slug} season=${r.seasonId}`);
    console.log(
      `     pg=${r.pgMembers} redis=${r.redisMembers} repairs=${r.applied}/${r.repairs.length} ` +
        `failed=${r.failed} healthyBefore=${r.healthyBefore} healthyAfter=${r.healthyAfter}`,
    );
    for (const rep of r.repairs) {
      const from = rep.redisScore !== undefined ? ` redis=${rep.redisScore}` : '';
      const to = rep.expectedScore !== undefined ? ` -> ${rep.expectedScore}` : '';
      console.log(`       - ${rep.kind.padEnd(7)} ${rep.creatorId}${from}${to}`);
    }
    if (r.error) console.log(`       ! error: ${r.error}`);
    if (!r.healthyAfter) unhealthy++;
  }

  if (reports.length === 0) console.log('no active seasons found');
  if (unhealthy > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('reconcile failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect(); // CLI exit: the cached singleton otherwise holds the event loop open
    pool.end();
  });
