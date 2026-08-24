import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { categories, seasons } from '../src/db/schema.js';
import { POST as webhookPost } from '../src/app/api/webhooks/stripe/route.js';
import { createCheckoutSession, type CheckoutSessionsApi } from '../src/features/bidding/checkout.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';

/**
 * Phase 3 settlement tests: synthetic Stripe events signed with the real
 * HMAC scheme drive the ACTUAL route handler (plain Request/Response — no
 * server needed). Covers signature enforcement, idempotency under
 * at-least-once delivery, the pending->succeeded trigger transition,
 * delayed-payment-method branches, and Q4 auto-refund paths.
 */

// The suite must run with a known signing secret even on fresh clones.
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_test_suite_secret';

const TRUNCATE = `TRUNCATE season_results, activities, clicks, bids, campaigns, seasons, creators, webhook_events, categories RESTART IDENTITY CASCADE`;

async function flushProjection(): Promise<void> {
  const keys = await redis.keys('blowup:*');
  if (keys.length > 0) await redis.del(...keys);
}

beforeEach(async () => {
  await db.execute(sql.raw(TRUNCATE));
  await flushProjection();
});

afterAll(async () => {
  await db.execute(sql.raw(TRUNCATE));
  await flushProjection();
  redis.disconnect();
  await pool.end();
});

const SECRET = () => process.env.STRIPE_WEBHOOK_SECRET!;

/** Sign exactly like Stripe does: HMAC-SHA256 over `${t}.${rawBody}`. */
function sign(raw: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', SECRET()).update(`${atSeconds}.${raw}`).digest('hex');
  return `t=${atSeconds},v1=${v1}`;
}

function makeRequest(raw: string, header: string): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: raw,
  });
}

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `cs_test_${randomUUID()}`,
    object: 'checkout.session',
    payment_intent: `pi_test_${randomUUID()}`,
    amount_total: 2500,
    currency: 'usd',
    payment_status: 'paid',
    metadata: {},
    ...overrides,
  };
}

interface Posted {
  status: number;
  body: { received?: boolean; outcome?: { kind: string; [k: string]: unknown } };
}

async function postSession(session: Record<string, unknown>, opts?: {
  eventId?: string;
  type?: string;
  headerForRaw?: string;
}): Promise<Posted> {
  const event = {
    id: opts?.eventId ?? `evt_${randomUUID()}`,
    type: opts?.type ?? 'checkout.session.completed',
    data: { object: session },
  };
  const raw = JSON.stringify(event);
  const res = await webhookPost(makeRequest(raw, opts?.headerForRaw ?? sign(raw)));
  let body: Posted['body'] = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error responses */
  }
  return { status: res.status, body };
}

async function mkActiveSeason(): Promise<{ slug: string; seasonId: string }> {
  const s = `w${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const [cat] = await db.insert(categories).values({ slug: s, name: s }).returning();
  const [season] = await db
    .insert(seasons)
    .values({
      categoryId: cat.id,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 7 * 24 * 3600_000),
      status: 'active',
    })
    .returning();
  return { slug: s, seasonId: season.id };
}

async function counts(): Promise<{ bids: number; activities: number }> {
  const r = await db.execute(
    sql`SELECT (SELECT count(*) FROM bids) AS bids, (SELECT count(*) FROM activities) AS activities`,
  );
  const row = r.rows[0] as { bids: string; activities: string };
  return { bids: Number(row.bids), activities: Number(row.activities) };
}

describe('webhook signature verification', () => {
  it('rejects an invalid signature with 400 and writes nothing', async () => {
    const ctx = await mkActiveSeason();
    const res = await postSession(makeSession({ metadata: { categorySlug: ctx.slug } }), {
      headerForRaw: sign('{"tampered":"different payload"}'),
    });
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('rejects a tampered payload that reuses a valid-format header', async () => {
    const ctx = await mkActiveSeason();
    const session = makeSession({ metadata: { categorySlug: ctx.slug } });
    // Sign the honest payload, then mutate the amount before sending.
    const evil = { ...session, amount_total: 1_000_000 };
    const res = await postSession(evil, { headerForRaw: sign(JSON.stringify(session)) });
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('rejects stale timestamps outside the tolerance window', async () => {
    await mkActiveSeason();
    // Validly signed FOR this payload, but captured too long ago.
    const raw = JSON.stringify({
      id: 'evt_stale',
      type: 'checkout.session.completed',
      data: { object: makeSession() },
    });
    const stale = Math.floor(Date.now() / 1000) - 4000;
    const res = await webhookPost(makeRequest(raw, sign(raw, stale)));
    expect(res.status).toBe(400);
  });

  it('rejects requests without the stripe-signature header', async () => {
    await mkActiveSeason();
    const res = await webhookPost(
      new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('settlement of checkout.session.completed', () => {
  it('settles end-to-end: real ids, trigger-stamped transition, projection agrees', async () => {
    const ctx = await mkActiveSeason();
    const session = makeSession({
      amount_total: 5000,
      metadata: { categorySlug: ctx.slug, handle: '@ada', name: 'Ada', seasonId: ctx.seasonId },
    });

    const posted = await postSession(session);
    expect(posted.status).toBe(200);
    expect(posted.body.outcome?.kind).toBe('settled');

    // Real Stripe ids on the append-only row; born pending, flipped via the
    // whitelisted transition (which stamps status_updated_at).
    const bidRes = await db.execute(sql`
      SELECT stripe_checkout_session_id AS cs, stripe_payment_intent_id AS pi,
             payment_status AS status, status_updated_at AS stamped, amount_cents AS amount
      FROM bids`);
    const bid = bidRes.rows[0] as {
      cs: string;
      pi: string;
      status: string;
      stamped: string | null;
      amount: string;
    };
    expect(bid.cs).toBe(session.id);
    expect(bid.pi).toBe(session.payment_intent);
    expect(bid.amount).toBe('5000');
    expect(bid.status).toBe('succeeded');
    expect(bid.stamped).not.toBeNull();

    // Rank + activity + projection all coherent.
    const feed = await db.execute(sql`SELECT type, previous_rank AS prev, new_rank FROM activities`);
    expect((feed.rows[0] as { type: string }).type).toBe('joined_board');
    const v = await verifyLeaderboard(ctx.slug);
    expect(v.match, v.reasons.join(' | ')).toBe(true);

    // Event marked processed.
    const evRes = await db.execute(sql`SELECT processed_at FROM webhook_events`);
    expect((evRes.rows[0] as { processed_at: string | null }).processed_at).not.toBeNull();
  });

  it('is a no-op when the same event id is redelivered', async () => {
    const ctx = await mkActiveSeason();
    const session = makeSession({
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });
    const first = await postSession(session, { eventId: 'evt_same' });
    expect(first.body.outcome?.kind).toBe('settled');

    const second = await postSession(session, { eventId: 'evt_same' });
    expect(second.body.outcome?.kind).toBe('duplicate_event');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('blocks double settlement when a different event carries the same payment intent', async () => {
    const ctx = await mkActiveSeason();
    const session = makeSession({
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });
    await postSession(session);

    const replay = await postSession(session, { eventId: `evt_${randomUUID()}` });
    expect(replay.body.outcome?.kind).toBe('duplicate_settlement');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('resumes an event left unprocessed by a crashed attempt instead of skipping it', async () => {
    const ctx = await mkActiveSeason();
    const session = makeSession({
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });
    // Simulate the crash window: receipt recorded, handler never finished.
    await db.execute(
      sql`INSERT INTO webhook_events (id, type) VALUES ('evt_crashed', 'checkout.session.completed')`,
    );

    const res = await postSession(session, { eventId: 'evt_crashed' });
    expect(res.body.outcome?.kind).toBe('settled');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });
});

describe('delayed-notification payment methods', () => {
  it('does not settle a completed-but-unpaid session', async () => {
    const ctx = await mkActiveSeason();
    const res = await postSession(
      makeSession({ payment_status: 'unpaid', metadata: { categorySlug: ctx.slug } }),
    );
    expect(res.body.outcome?.kind).toBe('awaiting_payment');
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('settles on checkout.session.async_payment_succeeded', async () => {
    const ctx = await mkActiveSeason();
    const res = await postSession(
      makeSession({
        payment_intent: `pi_test_${randomUUID()}`,
        metadata: { categorySlug: ctx.slug, handle: '@grace', seasonId: ctx.seasonId },
      }),
      { type: 'checkout.session.async_payment_succeeded' },
    );
    expect(res.body.outcome?.kind).toBe('settled');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('records async_payment_failed without settling or refunding', async () => {
    const ctx = await mkActiveSeason();
    const res = await postSession(
      makeSession({ payment_status: 'unpaid' }),
      { type: 'checkout.session.async_payment_failed' },
    );
    expect(res.body.outcome?.kind).toBe('async_payment_failed');
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });
});

describe('Q4 auto-refund paths', () => {
  function refundSpy(): { api: { create(p: { payment_intent: string }): Promise<unknown> }; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      api: {
        create: async (p) => {
          calls.push(p.payment_intent);
          return {};
        },
      },
    };
  }

  it('refunds when no active season exists for the metadata slug', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const spy = refundSpy();
    const pi = `pi_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: {
          object: makeSession({
            payment_intent: pi,
            metadata: { categorySlug: 'nonexistent', handle: '@ada', seasonId: randomUUID() },
          }),
        },
      },
      spy.api,
    );
    expect(outcome).toMatchObject({ kind: 'refunded', reason: 'no_active_season', paymentIntentId: pi });
    expect(spy.calls).toEqual([pi]);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('without a Stripe key, a required refund answers 500 and stays unprocessed for retry', async () => {
    const ctx = await mkActiveSeason();
    // STRIPE_SECRET_KEY is empty in this environment -> route has no refunds
    // client. Deliberate design: fail loudly (Stripe retries) rather than
    // silently keep money owed back to a bidder.
    const res = await postSession(
      makeSession({
        metadata: { categorySlug: 'nonexistent', handle: '@ada', seasonId: randomUUID() },
      }),
    );
    expect(res.status).toBe(500);
    const evRes = await db.execute(sql`SELECT processed_at FROM webhook_events`);
    expect((evRes.rows[0] as { processed_at: string | null }).processed_at).toBeNull();
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('refunds when the season rolled over since checkout (post-deadline money)', async () => {
    const ctx = await mkActiveSeason();
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const pi = `pi_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: {
          object: makeSession({
            payment_intent: pi,
            metadata: {
              categorySlug: ctx.slug,
              handle: '@ada',
              seasonId: randomUUID(), // not the active season -> rollover/refund
            },
          }),
        },
      },
      refundSpy().api,
    );
    expect(outcome.kind).toBe('refunded');
    expect(outcome).toMatchObject({ reason: 'season_rolled_over', paymentIntentId: pi });
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('refunds verified events whose amount is out of bounds (defense in depth)', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const ctx = await mkActiveSeason();
    const spy = refundSpy();
    const pi = `pi_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: {
          object: makeSession({
            payment_intent: pi,
            amount_total: 499, // below the $5 floor despite a valid signature
            metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
          }),
        },
      },
      spy.api,
    );
    expect(outcome).toMatchObject({ kind: 'refunded', reason: 'amount_out_of_bounds' });
    expect(spy.calls).toEqual([pi]);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('tolerates a redelivered refund (charge_already_refunded)', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const ctx = await mkActiveSeason();
    const calls: string[] = [];
    const alreadyRefundedApi = {
      create: async (p: { payment_intent: string }) => {
        calls.push(p.payment_intent);
        throw Object.assign(new Error('Charge has already been refunded.'), {
          raw: { code: 'charge_already_refunded' },
        });
      },
    };
    const outcome = await processVerifiedEvent(
      {
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: {
          object: makeSession({
            metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: randomUUID() },
          }),
        },
      },
      alreadyRefundedApi,
    );
    expect(outcome.kind).toBe('refunded'); // crash-resume safe, not a 500
  });
});

describe('miscellaneous verified events', () => {
  it('ignores unrelated event types while recording them', async () => {
    const res = await postSession({}, { type: 'invoice.paid' });
    expect(res.body.outcome?.kind).toBe('ignored');
    const evRes = await db.execute(sql`SELECT processed_at FROM webhook_events`);
    expect((evRes.rows[0] as { processed_at: string | null }).processed_at).not.toBeNull();
  });
});

describe('checkout session creation (unit)', () => {
  const recordingStub = (): { api: CheckoutSessionsApi; params: unknown[] } => {
    const params: unknown[] = [];
    return {
      params,
      api: {
        create: (async (p: unknown) => {
          params.push(p);
          return { id: `cs_new_${randomUUID()}`, url: 'https://checkout.stripe.com/c/pay/test' };
        }) as CheckoutSessionsApi['create'],
      },
    };
  };

  it('creates a dynamic-payment-method session with normalized identity metadata', async () => {
    const ctx = await mkActiveSeason();
    const stub = recordingStub();
    const created = await createCheckoutSession(
      { categorySlug: ctx.slug, handle: '@AdaLovelace', amountCents: 2500, name: 'Ada' },
      stub.api,
    );
    expect(created.url).toContain('https://checkout.stripe.com');
    const p = stub.params[0] as Record<string, any>;
    expect(p.mode).toBe('payment');
    expect(p.line_items[0].price_data.unit_amount).toBe(2500);
    expect(p.metadata).toEqual({
      categorySlug: ctx.slug,
      handle: '@adalovelace',
      name: 'Ada',
      seasonId: ctx.seasonId,
    });
    // stripe-best-practices: never restrict payment_method_types; tag the flow.
    expect('payment_method_types' in p).toBe(false);
    expect(typeof p.integration_identifier).toBe('string');
  });

  it('validates bounds and handles BEFORE calling Stripe', async () => {
    const ctx = await mkActiveSeason();
    const stub = recordingStub();
    await expect(
      createCheckoutSession({ categorySlug: ctx.slug, handle: '@okay', amountCents: 499 }, stub.api),
    ).rejects.toThrow(/between/);
    await expect(
      createCheckoutSession({ categorySlug: ctx.slug, handle: 'bad handle!', amountCents: 2500 }, stub.api),
    ).rejects.toThrow(/handle/);
    expect(stub.params).toHaveLength(0);
  });
});
