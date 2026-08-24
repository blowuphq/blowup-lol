import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Blowup.io data layer — implements the APPROVED schema in /docs/architecture.md.
 *
 * Invariants baked in here (and in drizzle/0001_* trigger migration):
 *  - Postgres is the single source of truth for money and rank.
 *  - `bids` is append-only: INSERT + payment_status lifecycle transitions only.
 *    Immutable columns are protected by a BEFORE UPDATE OR DELETE trigger.
 *  - Exactly one ACTIVE season per category, enforced by partial unique index.
 *  - Single bids are bounded: $5.00–$10,000.00 (amount_cents BETWEEN 500 AND 1000000).
 */

export const seasonStatusEnum = pgEnum('season_status', ['upcoming', 'active', 'ended']);
export const campaignStatusEnum = pgEnum('campaign_status', ['live', 'ended']);
export const bidPaymentStatusEnum = pgEnum('bid_payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);
export const activityTypeEnum = pgEnum('activity_type', ['bid', 'rank_change', 'joined_board']);

/** Lookup table — adding a category later is a data INSERT, never a migration. */
export const categories = pgTable('categories', {
  id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
  /** URL + Redis key segment. Immutable once created — treat as a stable identifier. */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creators = pgTable(
  'creators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    youtubeChannelId: text('youtube_channel_id').notNull().unique(),
    handle: text('handle').notNull().unique(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    subscriberCount: integer('subscriber_count'),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id),
    metadataFetchedAt: timestamp('metadata_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('creators_category_idx').on(t.categoryId)],
);

/** Partial unique index guarantees exactly one ACTIVE season per category at the DB level. */
export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: seasonStatusEnum('status').notNull().default('upcoming'),
  },
  (t) => [
    uniqueIndex('seasons_category_starts_unique').on(t.categoryId, t.startsAt),
    uniqueIndex('seasons_one_active_per_category')
      .on(t.categoryId)
      .where(sql`status = 'active'`),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    // Materialization maintained ONLY inside the transaction that appends the Bid row
    // (architecture F1); nightly job reconciles against SUM(bids).
    bidTotalCents: bigint('bid_total_cents', { mode: 'number' }).notNull().default(0),
    uniqueClicks: integer('unique_clicks').notNull().default(0),
    score: numeric('score', { precision: 14, scale: 4 }).notNull().default('0'),
    rank: integer('rank'),
    status: campaignStatusEnum('status').notNull().default('live'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaigns_creator_season_unique').on(t.creatorId, t.seasonId),
    index('campaigns_season_rank_idx').on(t.seasonId, t.rank),
    index('campaigns_season_score_idx').on(t.seasonId, t.score.desc()),
  ],
);

/**
 * APPEND-ONLY. The only permitted mutation is the payment_status lifecycle
 * (pending → succeeded|failed; succeeded → refunded), enforced by the
 * bids_append_only trigger (see drizzle/0002_*). Immutable columns can never change;
 * DELETE always raises.
 */
export const bids = pgTable(
  'bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    // Denormalized (F2): lets audits sum a season without joining campaigns.
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    paymentStatus: bidPaymentStatusEnum('payment_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
  },
  (t) => [
    check('bids_amount_range_check', sql`${t.amountCents} between 500 and 1000000`),
    // Idempotency anchor: duplicate Stripe events cannot credit twice. Multiple NULLs allowed
    // (pending bids have no PI yet).
    uniqueIndex('bids_payment_intent_unique').on(t.stripePaymentIntentId),
    index('bids_campaign_idx').on(t.campaignId),
    index('bids_created_at_idx').on(t.createdAt.desc()),
    index('bids_pending_idx')
      .on(t.paymentStatus)
      .where(sql`payment_status = 'pending'`),
  ],
);

export const clicks = pgTable(
  'clicks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    // HMAC(ip || ua || daily-salt) — no raw IP stored.
    sessionHash: text('session_hash').notNull(),
    referrer: text('referrer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('clicks_dedupe_idx').on(t.campaignId, t.sessionHash, t.createdAt),
    index('clicks_campaign_time_idx').on(t.campaignId, t.createdAt),
  ],
);

export const activities = pgTable(
  'activities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    type: activityTypeEnum('type').notNull(),
    previousRank: integer('previous_rank'),
    newRank: integer('new_rank'),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activities_season_created_idx').on(t.seasonId, t.createdAt.desc())],
);

/** Insert-first idempotency gate for Stripe's at-least-once webhook delivery. */
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(), // Stripe event ID
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

/** Immutable per-season snapshot written by the rollover transaction — permanent history. */
export const seasonResults = pgTable(
  'season_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    finalRank: integer('final_rank'),
    bestRank: integer('best_rank'),
    bidTotalCents: bigint('bid_total_cents', { mode: 'number' }).notNull(),
    uniqueClicks: integer('unique_clicks').notNull(),
    score: numeric('score', { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [uniqueIndex('season_results_season_creator_unique').on(t.seasonId, t.creatorId)],
);
