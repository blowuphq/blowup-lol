import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  activities,
  bids,
  campaigns,
  categories,
  clicks,
  creators,
  seasonResults,
  seasons,
  webhookEvents,
} from '../src/db/schema.js';

/**
 * Phase 1 schema tests — prove the three guarantees the architecture depends on:
 *   1. bids is append-only (immutable columns + DELETE blocked; only legal
 *      payment_status transitions pass) — enforced by the DB trigger.
 *   2. Foreign keys are correct (including RESTRICT on delete).
 *   3. The partial unique index enforces exactly one ACTIVE season per category.
 */

let pool: Pool;
let db: NodePgDatabase<Record<string, never>>;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
  // Leave the dev database clean — otherwise the LAST test's fixtures survive the suite
  // and break idempotent seeds that assert on global counts.
  await db.execute(sql`TRUNCATE season_results, activities, clicks, bids, campaigns, seasons, creators, webhook_events, categories RESTART IDENTITY CASCADE`);
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE season_results, activities, clicks, bids, campaigns, seasons, creators, webhook_events, categories RESTART IDENTITY CASCADE`);
});

const uniq = () => randomUUID().replaceAll('-', '').slice(0, 12);

/**
 * Drizzle wraps driver errors in DrizzleQueryError ("Failed query: ..."); the real
 * Postgres message (constraint name, trigger RAISE text) lives on `.cause`. Assert
 * against both layers.
 */
async function expectRejection(factory: () => Promise<unknown>, pattern: RegExp) {
  let rejected = false;
  try {
    await factory();
  } catch (err) {
    rejected = true;
    const cause = (err as { cause?: unknown }).cause;
    const text = [
      err instanceof Error ? err.message : String(err),
      cause instanceof Error ? cause.message : cause != null ? String(cause) : '',
    ].join('\n');
    expect(text).toMatch(pattern);
  }
  if (!rejected) throw new Error(`expected promise to reject with /${pattern.source}/ but it resolved`);
}

async function mkCategory(slug = `cat-${uniq()}`) {
  const [row] = await db.insert(categories).values({ slug, name: slug }).returning();
  return row;
}

async function mkSeason(categoryId: number, status: 'active' | 'ended' = 'active') {
  const now = Date.now();
  const [row] = await db
    .insert(seasons)
    .values({
      categoryId,
      startsAt: new Date(now - 60_000),
      endsAt: new Date(status === 'ended' ? now - 30_000 : now + 7 * 24 * 3600_000),
      status,
    })
    .returning();
  return row;
}

async function mkCreator(categoryId: number) {
  const [row] = await db
    .insert(creators)
    .values({
      youtubeChannelId: `UC${uniq()}`,
      handle: `@h_${uniq()}`,
      name: 'Test Creator',
      categoryId,
    })
    .returning();
  return row;
}

async function mkCampaign(creatorId: string, seasonId: string) {
  const [row] = await db.insert(campaigns).values({ creatorId, seasonId }).returning();
  return row;
}

async function mkBid(
  campaignId: string,
  creatorId: string,
  seasonId: string,
  amountCents = 2500,
) {
  const [row] = await db.insert(bids).values({ campaignId, creatorId, seasonId, amountCents }).returning();
  return row;
}

/** Full fixture chain: category → season → creator → campaign → bid. */
async function mkFixture(amountCents = 2500) {
  const category = await mkCategory();
  const season = await mkSeason(category.id);
  const creator = await mkCreator(category.id);
  const campaign = await mkCampaign(creator.id, season.id);
  const bid = await mkBid(campaign.id, creator.id, season.id, amountCents);
  return { category, season, creator, campaign, bid };
}

describe('one ACTIVE season per category (partial unique index)', () => {
  it('rejects a second active season in the same category', async () => {
    const cat = await mkCategory();
    await mkSeason(cat.id, 'active');
    await expectRejection(() => mkSeason(cat.id, 'active'), /seasons_one_active_per_category/);
  });

  it('allows concurrent active seasons in different categories', async () => {
    const tech = await mkCategory('tech');
    const gaming = await mkCategory('gaming');
    await expect(mkSeason(tech.id, 'active')).resolves.toBeDefined();
    await expect(mkSeason(gaming.id, 'active')).resolves.toBeDefined();
  });

  it('allows a new active season once the previous one has ended', async () => {
    const cat = await mkCategory();
    const first = await mkSeason(cat.id, 'active');
    await db.update(seasons).set({ status: 'ended' }).where(eq(seasons.id, first.id));
    await expect(mkSeason(cat.id, 'active')).resolves.toBeDefined();
  });
});

describe('bids are APPEND-ONLY (DB trigger)', () => {
  it('blocks UPDATE of immutable financial-history columns', async () => {
    const { bid } = await mkFixture();
    await expectRejection(
      () => db.update(bids).set({ amountCents: 999999 }).where(eq(bids.id, bid.id)),
      /append-only: immutable columns cannot change/,
    );
  });

  it('blocks re-pointing a bid at another campaign/creator/season', async () => {
    const f1 = await mkFixture();
    const f2 = await mkFixture();
    await expectRejection(
      () => db.update(bids).set({ campaignId: f2.campaign.id }).where(eq(bids.id, f1.bid.id)),
      /append-only: immutable columns cannot change/,
    );
    await expectRejection(
      () => db.update(bids).set({ creatorId: f2.creator.id }).where(eq(bids.id, f1.bid.id)),
      /append-only: immutable columns cannot change/,
    );
    await expectRejection(
      () => db.update(bids).set({ seasonId: f2.season.id }).where(eq(bids.id, f1.bid.id)),
      /append-only: immutable columns cannot change/,
    );
  });

  it('blocks even backdating created_at', async () => {
    const { bid } = await mkFixture();
    await expectRejection(
      () => db.update(bids).set({ createdAt: new Date(0) }).where(eq(bids.id, bid.id)),
      /append-only: immutable columns cannot change/,
    );
  });

  it('blocks DELETE', async () => {
    const { bid } = await mkFixture();
    await expectRejection(
      () => db.delete(bids).where(eq(bids.id, bid.id)),
      /append-only: DELETE not allowed/,
    );
  });

  it('allows the legal lifecycle pending -> succeeded and stamps status_updated_at', async () => {
    const { bid } = await mkFixture();
    await db
      .update(bids)
      .set({
        paymentStatus: 'succeeded',
        stripePaymentIntentId: `pi_${uniq()}`,
      })
      .where(eq(bids.id, bid.id));

    const [after] = await db.select().from(bids).where(eq(bids.id, bid.id));
    expect(after.paymentStatus).toBe('succeeded');
    expect(after.statusUpdatedAt).not.toBeNull();
  });

  it('allows succeeded -> refunded', async () => {
    const { bid } = await mkFixture();
    await db.update(bids).set({ paymentStatus: 'succeeded' }).where(eq(bids.id, bid.id));
    await db.update(bids).set({ paymentStatus: 'refunded' }).where(eq(bids.id, bid.id));
    const [after] = await db.select().from(bids).where(eq(bids.id, bid.id));
    expect(after.paymentStatus).toBe('refunded');
  });

  it('rejects illegal transitions out of terminal states', async () => {
    const { bid: b1 } = await mkFixture();
    await db.update(bids).set({ paymentStatus: 'failed' }).where(eq(bids.id, b1.id));
    await expectRejection(
      () => db.update(bids).set({ paymentStatus: 'succeeded' }).where(eq(bids.id, b1.id)),
      /illegal payment_status transition failed -> succeeded/,
    );

    const { bid: b2 } = await mkFixture();
    await db.update(bids).set({ paymentStatus: 'succeeded' }).where(eq(bids.id, b2.id));
    await expectRejection(
      () => db.update(bids).set({ paymentStatus: 'pending' }).where(eq(bids.id, b2.id)),
      /illegal payment_status transition succeeded -> pending/,
    );
  });
});

describe('bid amount bounds ($5 floor / $10,000 cap)', () => {
  it('accepts exactly $5.00 and exactly $10,000.00', async () => {
    const category = await mkCategory();
    const season = await mkSeason(category.id);
    const creator = await mkCreator(category.id);
    const campaign = await mkCampaign(creator.id, season.id);

    const min = await mkBid(campaign.id, creator.id, season.id, 500);
    expect(min.amountCents).toBe(500);

    const max = await mkBid(campaign.id, creator.id, season.id, 1_000_000);
    expect(max.amountCents).toBe(1_000_000);
  });

  it('rejects below $5.00 and above $10,000.00 at the DB level', async () => {
    const category = await mkCategory();
    const season = await mkSeason(category.id);
    const creator = await mkCreator(category.id);
    const campaign = await mkCampaign(creator.id, season.id);

    await expectRejection(
      () =>
        db.insert(bids).values({
          campaignId: campaign.id,
          creatorId: creator.id,
          seasonId: season.id,
          amountCents: 499,
        }),
      /bids_amount_range_check/,
    );

    await expectRejection(
      () =>
        db.insert(bids).values({
          campaignId: campaign.id,
          creatorId: creator.id,
          seasonId: season.id,
          amountCents: 1_000_001,
        }),
      /bids_amount_range_check/,
    );
  });
});

describe('foreign keys', () => {
  it('rejects creators pointing at an unknown category', async () => {
    await expectRejection(
      () =>
        db.insert(creators).values({
          youtubeChannelId: `UC${uniq()}`,
          handle: `@h_${uniq()}`,
          categoryId: 32000, // in smallint range but cannot exist (identity starts at 1)
        }),
      /foreign key/,
    );
  });

  it('rejects bids pointing at an unknown campaign', async () => {
    const category = await mkCategory();
    const season = await mkSeason(category.id);
    const creator = await mkCreator(category.id);
    await expectRejection(
      () =>
        db.insert(bids).values({
          campaignId: randomUUID(),
          creatorId: creator.id,
          seasonId: season.id,
          amountCents: 500,
        }),
      /foreign key/,
    );
  });

  it('RESTRICT prevents deleting a creator that still has campaigns/bids', async () => {
    const { creator } = await mkFixture();
    await expectRejection(
      () => db.delete(creators).where(eq(creators.id, creator.id)),
      /foreign key/,
    );
  });
});

describe('idempotency and history anchors', () => {
  it('webhook_events PK absorbs duplicate Stripe deliveries via ON CONFLICT DO NOTHING', async () => {
    const eventId = `evt_${uniq()}`;
    const first = await db
      .insert(webhookEvents)
      .values({ id: eventId, type: 'checkout.session.completed' })
      .onConflictDoNothing()
      .returning();
    const second = await db
      .insert(webhookEvents)
      .values({ id: eventId, type: 'checkout.session.completed' })
      .onConflictDoNothing()
      .returning();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('enforces one season_result per (season, creator)', async () => {
    const { season, creator } = await mkFixture();
    await db.insert(seasonResults).values({
      seasonId: season.id,
      creatorId: creator.id,
      bidTotalCents: 2500,
      uniqueClicks: 3,
      score: '42.0000',
    });
    await expectRejection(
      () =>
        db.insert(seasonResults).values({
          seasonId: season.id,
          creatorId: creator.id,
          bidTotalCents: 1000,
          uniqueClicks: 1,
          score: '10.0000',
        }),
      /season_results_season_creator_unique/,
    );
  });

  it('campaigns are unique per (creator, season)', async () => {
    const { season, creator } = await mkFixture();
    await expectRejection(
      () => db.insert(campaigns).values({ creatorId: creator.id, seasonId: season.id }),
      /campaigns_creator_season_unique/,
    );
  });

  it('clicks accept multiple rows per campaign (append-only log shape)', async () => {
    const { campaign, creator, season } = await mkFixture();
    for (let i = 0; i < 3; i++) {
      await db.insert(clicks).values({
        campaignId: campaign.id,
        creatorId: creator.id,
        seasonId: season.id,
        sessionHash: `sess-${i}`,
      });
    }
    const rows = await db.select().from(clicks);
    expect(rows).toHaveLength(3);
  });

  it('activities record rank transitions with previous/new rank', async () => {
    const { season, creator } = await mkFixture();
    const [activity] = await db
      .insert(activities)
      .values({
        seasonId: season.id,
        creatorId: creator.id,
        type: 'rank_change',
        previousRank: 7,
        newRank: 3,
      })
      .returning();
    expect(activity.previousRank).toBe(7);
    expect(activity.newRank).toBe(3);
  });
});
