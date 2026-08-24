import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db.js';
import { pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

/**
 * DEV-ONLY (Phase 2): dump a category's activity feed chronologically,
 * showing every rank transition Postgres recorded.
 *
 *   npm run dev:activity -- <categorySlug>
 */

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: tsx scripts/dev-activity.ts <categorySlug>');
    process.exitCode = 1;
    return;
  }

  const res = await db.execute(sql`
    SELECT a.created_at AS at,
           cr.handle,
           a.type,
           a.amount_cents     AS amount_cents,
           a.previous_rank    AS prev_rank,
           a.new_rank         AS new_rank
    FROM activities a
    JOIN seasons s   ON s.id = a.season_id
    JOIN categories c ON c.id = s.category_id AND c.slug = ${slug}
    JOIN creators cr ON cr.id = a.creator_id
    ORDER BY a.created_at ASC, a.id ASC
  `);

  console.log(`\nActivity feed for '${slug}' (chronological):`);
  const rows = res.rows as {
    at: string;
    handle: string;
    type: string;
    amount_cents: number | null;
    prev_rank: number | null;
    new_rank: number | null;
  }[];
  for (const r of rows) {
    const money =
      r.amount_cents != null ? `$${(r.amount_cents / 100).toFixed(2)}` : '-';
    const at = typeof r.at === 'string' ? r.at : String(r.at);
    console.log(
      `  ${at}  ${r.handle.padEnd(8)} ${r.type.padEnd(13)} bid=${money.padEnd(9)} prevRank=${String(r.prev_rank ?? 'null').padEnd(4)} newRank=${r.new_rank}`,
    );
  }
  if (rows.length === 0) console.log('  (no activity rows)');
}

main()
  .catch((err) => {
    console.error('failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect();
    pool.end();
  });
