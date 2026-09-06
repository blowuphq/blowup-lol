# Blowup.io Testing Guide

**Complete manual testing guide for all phases (1-5) with test data, setup instructions, and verification steps.**

---

## Prerequisites

### 1. Environment Setup

Create a `.env` file (if not already present) with all required variables:

```bash
# Database (Neon Postgres)
DATABASE_URL=postgresql://user:password@host/blowup?sslmode=require

# Redis (Upstash)
REDIS_URL=redis://default:password@host:port

# Dodo Payments (Phase 5 - current provider)
DODO_API_KEY=test_...
DODO_WEBHOOK_SECRET=whsec_...
DODO_BID_PRODUCT_ID=prod_...

# Optional: Inngest (for cron jobs)
INNGEST_SIGNING_KEY=signkey-...
INNGEST_EVENT_KEY=...
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Database

```bash
# Run migrations
npm run db:push

# Seed test data
npm run seed
```

The seed script creates:
- 3 categories: `tech-youtube`, `gaming-streamers`, `ai-builders`
- 1 active season per category (7 days duration)
- 5-10 creators per category with realistic metadata
- Initial bids and rankings

---

## Phase 1: Core Data Model & Seeding

**What was built:** Drizzle schema, migrations, seed script, basic leaderboard read logic.

### Test Data

The seed script (`scripts/seed.ts`) creates:

#### Categories
```typescript
{ slug: 'tech-youtube', name: 'Tech YouTube' }
{ slug: 'gaming-streamers', name: 'Gaming Streamers' }
{ slug: 'ai-builders', name: 'AI Builders' }
```

#### Creators (per category, example from tech-youtube)
```typescript
[
  { handle: '@mkbhd', name: 'Marques Brownlee', subscriberCount: 19_000_000 },
  { handle: '@linustechtips', name: 'Linus Tech Tips', subscriberCount: 15_500_000 },
  { handle: '@mrwhosetheboss', name: 'Mrwhosetheboss', subscriberCount: 18_200_000 },
  { handle: '@dave2d', name: 'Dave2D', subscriberCount: 4_100_000 },
  { handle: '@unboxtherapy', name: 'Unbox Therapy', subscriberCount: 18_000_000 },
]
```

#### Seasons
- **Active season per category:** starts yesterday, ends in 7 days
- Status: `'active'`

#### Initial Bids
The seed script creates 3-5 bids per creator with amounts between $5-$100:
```typescript
{ amountCents: 500, paymentStatus: 'succeeded' }   // $5.00
{ amountCents: 2500, paymentStatus: 'succeeded' }  // $25.00
{ amountCents: 10000, paymentStatus: 'succeeded' } // $100.00
```

### Manual Testing Steps

#### 1. Verify Database Seeded
```bash
npm run seed
```

**Expected output:**
```
✓ Seeded 3 categories
✓ Seeded tech-youtube: 5 creators, 15 bids
✓ Seeded gaming-streamers: 5 creators, 12 bids
✓ Seeded ai-builders: 5 creators, 10 bids
```

#### 2. Query Database Directly
```bash
# Connect to Postgres (adjust connection string)
psql $DATABASE_URL

# Check categories
SELECT * FROM categories;

# Check active seasons
SELECT c.slug, s.status, s.starts_at, s.ends_at 
FROM seasons s 
JOIN categories c ON c.id = s.category_id 
WHERE s.status = 'active';

# Check leaderboard for tech-youtube
SELECT 
  cr.handle, 
  cam.rank, 
  cam.bid_total_cents / 100.0 AS total_usd,
  cam.score
FROM campaigns cam
JOIN creators cr ON cr.id = cam.creator_id
JOIN seasons s ON s.id = cam.season_id
JOIN categories c ON c.id = s.category_id
WHERE c.slug = 'tech-youtube' AND s.status = 'active'
ORDER BY cam.rank NULLS LAST;
```

**Expected:** 5 creators ranked 1-5 with bid totals.

---

## Phase 2: Real-time Leaderboard (Redis Projection)

**What was built:** Redis ZSET projection, SSE endpoint, reconciler job, tiebreak logic.

### Test Data

Uses Phase 1 seed data. The reconciler (`npm run reconcile`) rebuilds Redis from Postgres.

### Manual Testing Steps

#### 1. Run Reconciler
```bash
npm run reconcile tech-youtube
```

**Expected output:**
```
✓ Reconciled tech-youtube: 5 campaigns synced to Redis
✓ Tiebreak seed: 12345
✓ Redis key: blowup:board:tech-youtube:season-<uuid>
```

#### 2. Verify Redis Projection
```bash
# Connect to Redis (Upstash CLI or redis-cli)
redis-cli -u $REDIS_URL

# Check sorted set
ZREVRANGE blowup:board:tech-youtube:<season-id> 0 -1 WITHSCORES
```

**Expected:** Creator UUIDs sorted by tiebreak-adjusted scores (highest first).

#### 3. Test SSE Endpoint (via curl)
```bash
# Stream live updates
curl -N http://localhost:3000/api/boards/tech-youtube/stream
```

**Expected:**
```
data: {"type":"snapshot","creators":[{"id":"...","handle":"@mkbhd","rank":1,"bidTotalCents":15000,...}],"tiebreakSeed":12345}

(Connection stays open, awaiting live events)
```

#### 4. Simulate a Bid (trigger live update)
Insert a bid manually to trigger SSE:
```sql
-- Get IDs first
SELECT id FROM categories WHERE slug = 'tech-youtube';
SELECT id FROM seasons WHERE category_id = <cat-id> AND status = 'active';
SELECT id, handle FROM creators WHERE category_id = <cat-id> LIMIT 1;

-- Insert a $50 bid
INSERT INTO bids (creator_id, campaign_id, season_id, amount_cents, currency, payment_status)
SELECT 
  '<creator-id>', 
  (SELECT id FROM campaigns WHERE creator_id = '<creator-id>' AND season_id = '<season-id>'),
  '<season-id>',
  5000,
  'USD',
  'succeeded';

-- Update campaign total
UPDATE campaigns 
SET bid_total_cents = bid_total_cents + 5000,
    updated_at = NOW()
WHERE creator_id = '<creator-id>' AND season_id = '<season-id>';
```

**Expected:** SSE stream emits a `settlement` event with updated rankings.

---

## Phase 3: Click Tracking & Scoring

**What was built:** Click deduplication (HMAC session hashing), F1 score formula, rank updates.

### Test Data

Seed data includes creators with initial `uniqueClicks` counts (0-50 range).

### Manual Testing Steps

#### 1. Verify Score Formula
```sql
-- Check score calculation for all campaigns
SELECT 
  cr.handle,
  cam.bid_total_cents / 100.0 AS bid_total_usd,
  cam.unique_clicks,
  cam.score::numeric(14,4) AS calculated_score,
  -- Manually verify: score = bid_total_cents * (1 + 0.1 * unique_clicks)
  (cam.bid_total_cents * (1.0 + 0.1 * cam.unique_clicks))::numeric(14,4) AS expected_score,
  cam.rank
FROM campaigns cam
JOIN creators cr ON cr.id = cam.creator_id
JOIN seasons s ON s.id = cam.season_id
JOIN categories c ON c.id = s.category_id
WHERE c.slug = 'tech-youtube' AND s.status = 'active'
ORDER BY cam.rank NULLS LAST;
```

**Expected:** `calculated_score` matches `expected_score`.

#### 2. Simulate Click Tracking
```bash
# Start dev server
npm run dev

# In another terminal, simulate clicks
curl -X POST http://localhost:3000/api/clicks \
  -H "Content-Type: application/json" \
  -d '{
    "creatorId": "<uuid>",
    "categorySlug": "tech-youtube",
    "referrer": "https://twitter.com"
  }'
```

**Expected response:**
```json
{ "success": true, "uniqueClick": true }
```

Verify in database:
```sql
SELECT * FROM clicks ORDER BY created_at DESC LIMIT 5;

SELECT handle, unique_clicks, score 
FROM campaigns cam
JOIN creators cr ON cr.id = cam.creator_id
WHERE cr.id = '<uuid>';
```

**Expected:** `unique_clicks` incremented, `score` recalculated.

---

## Phase 4: Live SSE Boards (Frontend)

**What was built:** LeaderboardScreen with SSE client, real-time rank animations, activity feed.

### Test Data

Uses existing seed data. Open the app in a browser to see live boards.

### Manual Testing Steps

#### 1. Start Dev Server
```bash
npm run dev
```

Navigate to: http://localhost:3000

#### 2. Test Landing Page
**URL:** http://localhost:3000

**Verify:**
- ✅ Hero section with "Blowup.io" branding
- ✅ Three category cards (Tech YouTube, Gaming Streamers, AI Builders)
- ✅ Click a card → navigates to `/boards/<slug>`

#### 3. Test Leaderboard Page
**URL:** http://localhost:3000/boards/tech-youtube

**Verify:**
- ✅ Table with columns: Rank, Creator, Avatar, Total Bids, Boost button
- ✅ Ranks displayed as #1, #2, etc.
- ✅ Bid totals formatted as $5.00, $25.00, etc.
- ✅ "Boost" button on each row
- ✅ Activity feed on the right (recent bids, rank changes)

#### 4. Test Real-time Updates
Keep the board page open in your browser, then trigger a settlement in another terminal:

**Option A: Via Test Script**
```bash
# Run webhook test that triggers settlement
npm run test tests/webhook.test.ts -t "settles end-to-end"
```

**Option B: Manually Insert Bid**
```sql
-- Use the SQL from Phase 2 Step 4 to insert a bid
```

**Expected:**
- ✅ SSE connection established (check browser DevTools → Network → stream)
- ✅ New bid appears in activity feed within 1-2 seconds
- ✅ Rank changes animate smoothly
- ✅ Bid total updates in real-time

#### 5. Test Error States
**Stop Redis:**
```bash
# Temporarily block Redis connection (adjust based on your setup)
# The SSE endpoint should return 503
```

Navigate to board → **Expected:** Error message displayed, no crash.

**Restore Redis and refresh** → Board loads normally.

---

## Phase 5: Dodo Payments Integration

**What was built:** Checkout flow, webhook settlement, signature verification, refund logic.

### Test Data

You'll need a Dodo Payments test account with test mode enabled.

#### Dodo Test Card Numbers
```
Successful Payment:
  Card: 4242 4242 4242 4242
  Exp: Any future date (e.g., 12/30)
  CVC: Any 3 digits (e.g., 123)
  ZIP: Any 5 digits (e.g., 12345)

Declined Payment:
  Card: 4000 0000 0000 0002
  
Requires Authentication (3D Secure):
  Card: 4000 0025 0000 3155
```

### Manual Testing Steps

#### 1. Test Checkout Flow (End-to-End)

**Start dev server:**
```bash
npm run dev
```

**Navigate to board:**
http://localhost:3000/boards/tech-youtube

**Steps:**
1. Click "Boost" on any creator (e.g., @mkbhd)
2. Modal opens with bid amount selector
3. Select amount: $5, $10, $25, $50, or custom
4. Click "Continue to Payment"
5. Redirected to Dodo hosted checkout page (`pay.dodo.com/...`)
6. Enter test card: `4242 4242 4242 4242`, exp `12/30`, CVC `123`
7. Click "Pay"
8. Redirected back to board with `?success=true`

**Expected:**
- ✅ Dodo checkout page loads
- ✅ Payment succeeds
- ✅ Redirected back to board

**Verify webhook received:**
```bash
# Check function logs (if deployed) or dev server output
# Look for: [webhook] signature verification passed
#           [webhook] settlement outcome: settled
```

**Verify in database:**
```sql
-- Check bid was inserted
SELECT * FROM bids ORDER BY created_at DESC LIMIT 1;

-- Expected: payment_status = 'succeeded'
--           stripe_checkout_session_id = 'cs_test_...' (Dodo session ID)
--           stripe_payment_intent_id = 'pay_test_...' (Dodo payment ID)

-- Check webhook event recorded
SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 1;

-- Expected: processed_at IS NOT NULL

-- Check leaderboard updated
SELECT handle, rank, bid_total_cents / 100.0 AS total_usd
FROM campaigns cam
JOIN creators cr ON cr.id = cam.creator_id
WHERE cam.season_id = (
  SELECT id FROM seasons WHERE category_id = (
    SELECT id FROM categories WHERE slug = 'tech-youtube'
  ) AND status = 'active'
)
ORDER BY rank NULLS LAST;

-- Expected: Rank updated, total increased
```

#### 2. Test Webhook Signature Verification

**Invalid signature (should reject):**
```bash
curl -X POST http://localhost:3000/api/webhooks/dodo \
  -H "Content-Type: application/json" \
  -H "webhook-id: msg_fake123" \
  -H "webhook-timestamp: 1234567890" \
  -H "webhook-signature: v1,fakesignature" \
  -d '{"type":"payment.succeeded","data":{"payment_id":"pay_123"}}'
```

**Expected response:**
```
HTTP 400: invalid signature
```

**Valid signature (manual generation):**
```javascript
// Run in Node.js REPL or script
const { Webhook } = require('standardwebhooks');
const crypto = require('crypto');

const secret = process.env.DODO_WEBHOOK_SECRET; // Your webhook secret
const msgId = `msg_${crypto.randomUUID()}`;
const timestamp = new Date();
const payload = JSON.stringify({
  type: 'payment.succeeded',
  business_id: 'biz_test',
  timestamp: timestamp.toISOString(),
  data: {
    payment_id: 'pay_manual_test_123',
    checkout_session_id: 'cs_manual_test_123',
    total_amount: 2500,
    currency: 'USD',
    status: 'succeeded',
    metadata: {
      categorySlug: 'tech-youtube',
      handle: '@mkbhd',
      seasonId: '<get from DB>',
    },
  },
});

const wh = new Webhook(secret);
const signature = wh.sign(msgId, timestamp, payload);

console.log(`curl -X POST http://localhost:3000/api/webhooks/dodo \\
  -H "Content-Type: application/json" \\
  -H "webhook-id: ${msgId}" \\
  -H "webhook-timestamp: ${Math.floor(timestamp.getTime() / 1000)}" \\
  -H "webhook-signature: ${signature}" \\
  -d '${payload}'`);
```

Run the generated curl command.

**Expected response:**
```json
{ "received": true, "outcome": { "kind": "settled", "slug": "tech-youtube", "result": {...} } }
```

#### 3. Test Idempotency (Duplicate Webhook)

Re-run the same curl command from step 2 (same `webhook-id`, `payment_id`).

**Expected response:**
```json
{ "received": true, "outcome": { "kind": "duplicate_event" } }
```

**Verify:** No additional bid inserted, no rank change.

#### 4. Test Q4 Auto-Refund Paths

**Scenario A: Season Rolled Over (bid arrives after season ended)**

```sql
-- End the current season
UPDATE seasons 
SET status = 'ended', ends_at = NOW() - INTERVAL '1 hour'
WHERE category_id = (SELECT id FROM categories WHERE slug = 'tech-youtube')
AND status = 'active';

-- Create new active season
INSERT INTO seasons (category_id, starts_at, ends_at, status)
SELECT 
  id,
  NOW(),
  NOW() + INTERVAL '7 days',
  'active'
FROM categories WHERE slug = 'tech-youtube';
```

Send webhook with **old season_id** in metadata:

```bash
# Use the old season ID in metadata
# (Generate signature as in step 2, but with old seasonId)
```

**Expected:**
- ✅ Response: `{ "outcome": { "kind": "refunded", "reason": "season_rolled_over" } }`
- ✅ No bid inserted
- ✅ Refund created via Dodo API (if `DODO_API_KEY` set)

**Scenario B: Amount Out of Bounds**

Send webhook with `total_amount: 400` (below $5 floor):

**Expected:**
- ✅ Response: `{ "outcome": { "kind": "refunded", "reason": "amount_out_of_bounds" } }`
- ✅ No bid inserted
- ✅ Refund created

**Scenario C: Missing API Key (should fail loudly)**

```bash
# Temporarily unset DODO_API_KEY
unset DODO_API_KEY

# Send webhook that requires refund (e.g., rolled over season)
```

**Expected:**
- ✅ Response: `HTTP 500: processing error`
- ✅ Webhook event recorded with `processed_at = NULL` (will retry)

Restore `DODO_API_KEY` and resend → refund succeeds.

---

## Phase 4.3: Self-Serve Creator Claim

**What was built:** Form where creators submit YouTube channel URLs for verification.

### Manual Testing Steps

#### 1. Navigate to Claim Form
**URL:** http://localhost:3000/creators/claim

**Verify:**
- ✅ Form with fields: YouTube Channel URL, Email, Name (optional)
- ✅ Validation: URL must be valid YouTube channel format
- ✅ Submit button

#### 2. Submit Valid Channel
**Test data:**
```
YouTube URL: https://www.youtube.com/@mkbhd
Email: test@example.com
Name: Test Creator
```

**Expected:**
- ✅ Form submits successfully
- ✅ Success message: "Claim submitted! We'll review and add you to the board."
- ✅ (Backend: would store in DB or send to admin queue — check implementation)

#### 3. Submit Invalid Data
**Test cases:**
```
Invalid URL: https://twitter.com/mkbhd
Expected: "Please enter a valid YouTube channel URL"

Missing email:
Expected: "Email is required"

Duplicate channel (submit twice):
Expected: "This channel has already been claimed"
```

---

## Phase 4.6: Marketing Landing Page

**What was built:** Root landing page with hero, category showcase, demo board embed.

### Manual Testing Steps

#### 1. Test Landing Page
**URL:** http://localhost:3000

**Verify:**
- ✅ Hero section with headline + CTA
- ✅ Category showcase (3 cards)
- ✅ Demo board section (embedded leaderboard or screenshot)
- ✅ Footer with links

#### 2. Test Navigation
- Click "View Tech YouTube Board" → navigates to `/boards/tech-youtube`
- Click category card → navigates to board
- Click "Boost" on demo board → opens checkout modal

---

## Automated Test Suite

Run all tests to verify end-to-end integrity:

```bash
# Run full test suite
npm run test

# Expected output:
# Test Files  8 passed (8)
#      Tests  87 passed (87)
```

### Test Coverage by Phase

**Phase 1-2 (Data + Redis):**
- `tests/reconcile.test.ts` — 12 tests (tiebreak, idempotency, projection)
- `tests/leaderboard.test.ts` — 8 tests (read logic, SSE snapshots)

**Phase 3 (Scoring):**
- `tests/scoring.test.ts` — 10 tests (F1 formula, click dedup, rank updates)

**Phase 4 (SSE):**
- `tests/sse.test.ts` — 15 tests (live events, reconnection, error handling)

**Phase 5 (Payments):**
- `tests/webhook.test.ts` — 18 tests (signature verification, settlement, refunds)
- `tests/checkout.test.ts` — 6 tests (validation, session creation)

**Infrastructure:**
- `tests/env-guard.test.ts` — 8 tests (production safety, env var guards)
- `tests/schema.test.ts` — 10 tests (migrations, triggers, constraints)

---

## Common Issues & Troubleshooting

### Issue: "DODO_WEBHOOK_SECRET is not set"
**Fix:** Add to `.env`:
```bash
DODO_WEBHOOK_SECRET=whsec_...
```

### Issue: Redis connection timeout
**Fix:** Check `REDIS_URL` format (Upstash requires SSL):
```bash
REDIS_URL=rediss://default:password@host:port
```

### Issue: Database migration errors
**Fix:** Reset database:
```bash
npm run db:push
npm run seed
```

### Issue: SSE connection fails in browser
**Fix:** Check browser console for errors. Ensure dev server is running on correct port.
```bash
# Check server logs
npm run dev
```

### Issue: Webhook signature verification fails
**Fix:** Verify secret matches between Dodo dashboard and `.env`:
1. Go to Dodo dashboard → Webhooks → Endpoint
2. Copy webhook secret
3. Update `.env`: `DODO_WEBHOOK_SECRET=whsec_...`

---

## Production Testing Checklist

Before deploying to production:

### Pre-Deploy
- [ ] All 87 tests pass locally (`npm run test`)
- [ ] Database migrations applied to production DB
- [ ] Environment variables set in Vercel dashboard
- [ ] Dodo webhook endpoint configured: `https://blowup.lol/api/webhooks/dodo`
- [ ] Dodo webhook events enabled: `payment.succeeded`, `payment.failed`, `payment.processing`

### Post-Deploy
- [ ] Navigate to production URL: https://blowup.lol
- [ ] Verify landing page loads
- [ ] Open a board: https://blowup.lol/boards/tech-youtube
- [ ] Verify leaderboard renders (data from production DB)
- [ ] Test SSE connection (DevTools → Network → check `stream` connection)
- [ ] Complete one real test payment:
  - [ ] Click "Boost" on a creator
  - [ ] Complete Dodo checkout with test card
  - [ ] Verify webhook received (check Vercel function logs)
  - [ ] Verify bid inserted in production DB
  - [ ] Verify rank updated on live board
  - [ ] Verify SSE event broadcast to connected clients

### Monitoring
- [ ] Set up Vercel log streaming: `vercel logs --follow`
- [ ] Monitor webhook deliveries in Dodo dashboard
- [ ] Check error rates in Vercel Analytics
- [ ] Verify Redis memory usage (Upstash dashboard)

---

## Quick Reference: Test Accounts & Data

### Dodo Test Cards
| Scenario | Card Number | Exp | CVC |
|----------|-------------|-----|-----|
| Success | 4242 4242 4242 4242 | 12/30 | 123 |
| Declined | 4000 0000 0000 0002 | 12/30 | 123 |
| 3D Secure | 4000 0025 0000 3155 | 12/30 | 123 |

### Seed Data Categories
- `tech-youtube` — 5 creators, active season
- `gaming-streamers` — 5 creators, active season
- `ai-builders` — 5 creators, active season

### Test Bid Amounts
- Minimum: $5.00 (500 cents)
- Maximum: $10,000.00 (1,000,000 cents)
- Custom: any amount in range

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/checkout` | POST | Create Dodo checkout session |
| `/api/webhooks/dodo` | POST | Receive Dodo webhook events |
| `/api/boards/:slug/stream` | GET | SSE leaderboard stream |
| `/api/clicks` | POST | Track creator link clicks |

---

## Summary

This guide covers complete manual testing for all 5 phases of Blowup.io. Each phase includes:
- ✅ Test data (seed scripts, SQL queries, test cards)
- ✅ Step-by-step verification procedures
- ✅ Expected outcomes at each step
- ✅ Troubleshooting for common issues

For automated testing, run `npm run test` (87 tests covering all phases).

For production deploy verification, follow the **Production Testing Checklist** section.
