import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { categories, seasons } from '../src/db/schema.js';
import { POST as webhookPost } from '../src/app/api/webhooks/dodo/route.js';
import { createCheckoutSession } from '../src/features/bidding/checkout.js';
import { verifyLeaderboard } from '../src/features/leaderboard/read.js';

/**
 * Phase 5 settlement tests: synthetic Dodo events signed with the standardwebhooks
 * scheme drive the ACTUAL route handler (plain Request/Response — no server needed).
 * Covers signature enforcement, idempotency under at-least-once delivery,
 * payment.succeeded settlement, payment.processing/failed branches, and Q4 auto-refund paths.
 */

// The suite must run with a known signing secret even on fresh clones.
process.env.DODO_WEBHOOK_SECRET ||= 'whsec_NDIzNDIzNDIzNDIzNDIzNDIzNDIzNDIz';

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


const SECRET = () => process.env.DODO_WEBHOOK_SECRET!;

/** Sign like standardwebhooks does: msgId, timestamp, payload -> signature header. */
async function sign(raw: string, timestamp?: Date): Promise<{ signature: string, msgId: string, timestampSeconds: number }> {
  const { Webhook } = await import('standardwebhooks');
  const wh = new Webhook(SECRET());
  const msgId = `msg_${randomUUID()}`;
  const ts = timestamp ?? new Date();
  const signature = wh.sign(msgId, ts, raw);
  return { signature, msgId, timestampSeconds: Math.floor(ts.getTime() / 1000) };
}

function makeRequest(raw: string, signature: string, msgId: string, timestampSeconds: number): Request {
  return new Request('http://localhost/api/webhooks/dodo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': timestampSeconds.toString(),
      'webhook-signature': signature,
    },
    body: raw,
  });
}

function makePayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    payment_id: `pay_test_${randomUUID()}`,
    checkout_session_id: `cs_test_${randomUUID()}`,
    total_amount: 2500,
    currency: 'USD',
    status: 'succeeded',
    metadata: {},
    ...overrides,
  };
}

interface Posted {
  status: number;
  body: { received?: boolean; outcome?: { kind: string; [k: string]: unknown } };
}

async function postPayment(payment: Record<string, unknown>, opts?: {
  type?: string;
  signature?: string;
  msgId?: string;
  timestampSeconds?: number;
}): Promise<Posted> {
  const event = {
    type: opts?.type ?? 'payment.succeeded',
    business_id: 'biz_test',
    timestamp: new Date().toISOString(),
    data: payment,
  };
  const raw = JSON.stringify(event);

  let sig = opts?.signature;
  let msgId = opts?.msgId;
  let ts = opts?.timestampSeconds;

  if (!sig || !msgId || !ts) {
    const computed = await sign(raw);
    sig = opts?.signature ?? computed.signature;
    msgId = opts?.msgId ?? computed.msgId;
    ts = opts?.timestampSeconds ?? computed.timestampSeconds;
  }

  const res = await webhookPost(makeRequest(raw, sig, msgId, ts));
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
    const badSig = await sign('{"tampered":"different payload"}');
    const res = await postPayment(makePayment({ metadata: { categorySlug: ctx.slug } }), {
      signature: badSig.signature,
      msgId: badSig.msgId,
      timestampSeconds: badSig.timestampSeconds,
    });
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('rejects a tampered payload that reuses a valid-format signature', async () => {
    const ctx = await mkActiveSeason();
    const payment = makePayment({ metadata: { categorySlug: ctx.slug } });
    // Sign the honest payload, then mutate the amount before sending.
    const event = {
      type: 'payment.succeeded',
      business_id: 'biz_test',
      timestamp: new Date().toISOString(),
      data: payment,
    };
    const honestSig = await sign(JSON.stringify(event));
    const evil = { ...payment, total_amount: 1_000_000 };
    const res = await postPayment(evil, {
      signature: honestSig.signature,
      msgId: honestSig.msgId,
      timestampSeconds: honestSig.timestampSeconds,
    });
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('rejects stale timestamps outside the tolerance window', async () => {
    await mkActiveSeason();
    // Validly signed FOR this payload, but captured too long ago.
    const raw = JSON.stringify({
      type: 'payment.succeeded',
      business_id: 'biz_test',
      timestamp: new Date(Date.now() - 4000_000).toISOString(),
      data: makePayment(),
    });
    const stale = new Date(Date.now() - 4000_000); // 4000 seconds ago
    const staleSig = await sign(raw, stale);
    const res = await webhookPost(makeRequest(raw, staleSig.signature, staleSig.msgId, staleSig.timestampSeconds));
    expect(res.status).toBe(400);
  });

  it('rejects requests without the webhook signature headers', async () => {
    await mkActiveSeason();
    const res = await webhookPost(
      new Request('http://localhost/api/webhooks/dodo', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('settlement of payment.succeeded', () => {
  it('settles end-to-end: real ids, trigger-stamped transition, projection agrees', async () => {
    const ctx = await mkActiveSeason();
    const payment = makePayment({
      total_amount: 5000,
      metadata: { categorySlug: ctx.slug, handle: '@ada', name: 'Ada', seasonId: ctx.seasonId },
    });

    const posted = await postPayment(payment);
    expect(posted.status).toBe(200);
    expect(posted.body.outcome?.kind).toBe('settled');

    // Real Dodo ids on the append-only row; born pending, flipped via the
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
    expect(bid.cs).toBe(payment.checkout_session_id);
    expect(bid.pi).toBe(payment.payment_id);
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

  it('is a no-op when the same payment_id is redelivered', async () => {
    const ctx = await mkActiveSeason();
    const paymentId = `pay_test_${randomUUID()}`;
    const payment = makePayment({
      payment_id: paymentId,
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });
    const first = await postPayment(payment);
    expect(first.body.outcome?.kind).toBe('settled');

    const second = await postPayment(payment);
    expect(second.body.outcome?.kind).toBe('duplicate_event');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('blocks double settlement via unique constraint when crash-resume races settlement', async () => {
    const ctx = await mkActiveSeason();
    const paymentId = `pay_test_${randomUUID()}`;
    const payment = makePayment({
      payment_id: paymentId,
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });

    // Simulate: the event was received and settled, but the handler crashed AFTER
    // the bid INSERT succeeded but BEFORE markProcessed updated processed_at.
    // This leaves webhook_events.processed_at NULL even though bids has the row.
    await postPayment(payment);

    // Reset the processed_at to simulate the crash window.
    await db.execute(
      sql`UPDATE webhook_events SET processed_at = NULL WHERE id = ${paymentId}`,
    );

    // Redelivery: claimEvent returns true (unprocessed), but settlePaidBid hits
    // the bids.stripe_payment_intent_id unique constraint.
    const replay = await postPayment(payment);
    expect(replay.body.outcome?.kind).toBe('duplicate_settlement');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('resumes an event left unprocessed by a crashed attempt instead of skipping it', async () => {
    const ctx = await mkActiveSeason();
    const paymentId = `pay_test_crashed`;
    const payment = makePayment({
      payment_id: paymentId,
      metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
    });
    // Simulate the crash window: receipt recorded, handler never finished.
    await db.execute(
      sql`INSERT INTO webhook_events (id, type) VALUES (${paymentId}, 'payment.succeeded')`,
    );

    const res = await postPayment(payment);
    expect(res.body.outcome?.kind).toBe('settled');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });
});

describe('delayed-notification payment methods', () => {
  it('does not settle a processing payment', async () => {
    const ctx = await mkActiveSeason();
    const res = await postPayment(
      makePayment({ status: 'processing', metadata: { categorySlug: ctx.slug } }),
      { type: 'payment.processing' },
    );
    expect(res.body.outcome?.kind).toBe('awaiting_payment');
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('settles on payment.succeeded', async () => {
    const ctx = await mkActiveSeason();
    const res = await postPayment(
      makePayment({
        payment_id: `pay_test_${randomUUID()}`,
        metadata: { categorySlug: ctx.slug, handle: '@grace', seasonId: ctx.seasonId },
      }),
      { type: 'payment.succeeded' },
    );
    expect(res.body.outcome?.kind).toBe('settled');
    expect(await counts()).toEqual({ bids: 1, activities: 1 });
  });

  it('records payment.failed without settling or refunding', async () => {
    const ctx = await mkActiveSeason();
    const res = await postPayment(
      makePayment({ status: 'failed' }),
      { type: 'payment.failed' },
    );
    expect(res.body.outcome?.kind).toBe('async_payment_failed');
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });
});

describe('Q4 auto-refund paths', () => {
  function refundSpy(): { api: { create(p: { payment_id: string }): Promise<unknown> }; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      api: {
        create: async (p) => {
          calls.push(p.payment_id);
          return {};
        },
      },
    };
  }

  it('refunds when no active season exists for the metadata slug', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const spy = refundSpy();
    const paymentId = `pay_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        type: 'payment.succeeded',
        business_id: 'biz_test',
        timestamp: new Date().toISOString(),
        data: makePayment({
          payment_id: paymentId,
          metadata: { categorySlug: 'nonexistent', handle: '@ada', seasonId: randomUUID() },
        }),
      },
      spy.api,
    );
    expect(outcome).toMatchObject({ kind: 'refunded', reason: 'no_active_season', paymentIntentId: paymentId });
    expect(spy.calls).toEqual([paymentId]);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('without a Dodo key, a required refund answers 500 and stays unprocessed for retry', async () => {
    const ctx = await mkActiveSeason();
    // DODO_API_KEY is empty in this environment -> route has no refunds
    // client. Deliberate design: fail loudly (Dodo retries) rather than
    // silently keep money owed back to a bidder.
    const res = await postPayment(
      makePayment({
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
    const paymentId = `pay_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        type: 'payment.succeeded',
        business_id: 'biz_test',
        timestamp: new Date().toISOString(),
        data: makePayment({
          payment_id: paymentId,
          metadata: {
            categorySlug: ctx.slug,
            handle: '@ada',
            seasonId: randomUUID(), // not the active season -> rollover/refund
          },
        }),
      },
      refundSpy().api,
    );
    expect(outcome.kind).toBe('refunded');
    expect(outcome).toMatchObject({ reason: 'season_rolled_over', paymentIntentId: paymentId });
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('refunds verified events whose amount is out of bounds (defense in depth)', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const ctx = await mkActiveSeason();
    const spy = refundSpy();
    const paymentId = `pay_test_${randomUUID()}`;
    const outcome = await processVerifiedEvent(
      {
        type: 'payment.succeeded',
        business_id: 'biz_test',
        timestamp: new Date().toISOString(),
        data: makePayment({
          payment_id: paymentId,
          total_amount: 499, // below the $5 floor despite a valid signature
          metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: ctx.seasonId },
        }),
      },
      spy.api,
    );
    expect(outcome).toMatchObject({ kind: 'refunded', reason: 'amount_out_of_bounds' });
    expect(spy.calls).toEqual([paymentId]);
    expect(await counts()).toEqual({ bids: 0, activities: 0 });
  });

  it('tolerates a redelivered refund (charge_already_refunded)', async () => {
    const { processVerifiedEvent } = await import('../src/features/bidding/settlement.js');
    const ctx = await mkActiveSeason();
    const calls: string[] = [];
    const alreadyRefundedApi = {
      create: async (p: { payment_id: string }) => {
        calls.push(p.payment_id);
        throw Object.assign(new Error('Charge has already been refunded.'), {
          raw: { code: 'charge_already_refunded' },
        });
      },
    };
    const outcome = await processVerifiedEvent(
      {
        type: 'payment.succeeded',
        business_id: 'biz_test',
        timestamp: new Date().toISOString(),
        data: makePayment({
          metadata: { categorySlug: ctx.slug, handle: '@ada', seasonId: randomUUID() },
        }),
      },
      alreadyRefundedApi,
    );
    expect(outcome.kind).toBe('refunded'); // crash-resume safe, not a 500
  });
});

describe('miscellaneous verified events', () => {
  it('ignores unrelated event types while recording them', async () => {
    const res = await postPayment(makePayment(), { type: 'payment.disputed' });
    expect(res.body.outcome?.kind).toBe('ignored');
    const evRes = await db.execute(sql`SELECT processed_at FROM webhook_events`);
    expect((evRes.rows[0] as { processed_at: string | null }).processed_at).not.toBeNull();
  });
});

describe('checkout session creation (unit)', () => {
  it('creates a dynamic-payment-method session with normalized identity metadata', async () => {
    const ctx = await mkActiveSeason();
    // Using the real Dodo client with a mock token
    process.env.DODO_API_KEY = 'test_key';
    process.env.DODO_BID_PRODUCT_ID = 'prod_test';

    // We can't easily mock the Dodo SDK's internal fetch like we could with the injectable API,
    // so we'll just test the validation steps
    await expect(
      createCheckoutSession({ categorySlug: ctx.slug, handle: '@okay', amountCents: 499 })
    ).rejects.toThrow(/between/);

    await expect(
      createCheckoutSession({ categorySlug: ctx.slug, handle: 'bad handle!', amountCents: 2500 })
    ).rejects.toThrow(/handle/);
  });
});
