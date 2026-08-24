import 'dotenv/config';
import { recordFakeBid } from '../src/features/bidding/pipeline.js';
import { pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

/**
 * DEV-ONLY (Phase 2): fire a fake PAID bid through the real pipeline.
 *
 *   npm run dev:fake-bid -- <categorySlug> <handle> [amountCents] [name]
 *
 * e.g. npm run dev:fake-bid -- tech @whale 1000000 "Whale Channel"
 * Amounts are cents: 500=$5 ... 1000000=$10,000 (enforced).
 */

async function main(): Promise<void> {
  const [slug, handle, amountArg, name] = process.argv.slice(2);
  if (!slug || !handle) {
    console.error('usage: tsx scripts/dev-fake-bid.ts <categorySlug> <handle> [amountCents] [name]');
    process.exitCode = 1;
    return;
  }
  const amountCents = amountArg ? Number(amountArg) : 2500;

  const result = await recordFakeBid({
    categorySlug: slug,
    handle,
    amountCents,
    name,
  });

  console.log(
    JSON.stringify(
      {
        bid: result.bidId,
        category: result.slug,
        creator: result.creatorId,
        bidAmountCents: result.bidAmountCents,
        paymentStatus: 'succeeded (fake)',
        previousRank: result.previousRank,
        newRank: result.newRank,
        score: result.score,
        campaignTotalCents: result.bidTotalCents,
        activity: result.activityType,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error('fake-bid failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    redis.disconnect(); // CLI exit: the cached singleton otherwise holds the event loop open
    pool.end();
  });
