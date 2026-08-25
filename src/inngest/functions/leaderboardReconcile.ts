import { reconcileAllActive } from '../../features/leaderboard/reconcile.js';
import { inngest } from '../client.js';

/**
 * leaderboardReconcile (architecture §6): every 5 minutes, diff each active
 * season's Redis ZSET against what Postgres alone computes and repair drift
 * with targeted ZADD/ZREMs — closing the R1 crash window (PG committed, ZADD
 * lost) and R2's fail-open silent drift before Phase 4 (SSE) starts reading
 * this projection live.
 *
 * Read-only toward PG, holds no advisory lock — always safe next to
 * settlement. Throws if any season could not be brought back into agreement,
 * so Inngest retries with backoff.
 */
export const leaderboardReconcile = inngest.createFunction(
  {
    id: 'leaderboard-reconcile',
    name: 'Leaderboard reconcile (Redis ↔ PG diff repair)',
    triggers: [{ cron: '*/5 * * * *' }],
    retries: 2,
  },
  async () => {
    const reports = await reconcileAllActive();

    for (const r of reports) {
      const line = `${r.slug}: pg=${r.pgMembers} redis=${r.redisMembers} repairs=${r.applied}/${r.repairs.length} failed=${r.failed} healthy=${r.healthyAfter}`;
      if (r.error) console.error(`[leaderboardReconcile] ${r.slug}: FAILED — ${r.error}`);
      else console.log(`[leaderboardReconcile] ${line}`);
    }

    const broken = reports.filter((r) => !r.healthyAfter);
    if (broken.length > 0) {
      throw new Error(
        `leaderboard reconciliation incomplete for: ${broken.map((b) => b.slug).join(', ')}`,
      );
    }
    return {
      seasons: reports.length,
      repairsApplied: reports.reduce((n, r) => n + r.applied, 0),
    };
  },
);
