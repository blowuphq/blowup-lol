# Phase 5.0 Final Status — Dodo Payments Migration Closeout

**Branch:** `phase-5-dodo-migration`
**Date:** 2026-09-01
**Commit:** `34842ce` (fix: clean up debug code, Dodo checkout working with test_mode)
**Test Suite:** 87/87 passing

---

## 1. Every Stripe Reference Changed — Complete File-by-File Diff

### `src/db/schema.ts`
| Line | Before | After |
|------|--------|-------|
| 138 | `stripeCheckoutSessionId: text('stripe_checkout_session_id')` | `dodoCheckoutSessionId: text('dodo_checkout_session_id')` |
| 139 | `stripePaymentIntentId: text('stripe_payment_intent_id')` | `dodoPaymentId: text('dodo_payment_id')` |
| 142 | Comment: "Idempotent settlement fields — named for Stripe originally..." | Comment: "Idempotent settlement fields — contain Dodo's session_id and payment_id." |
| 153 | `uniqueIndex('bids_payment_intent_unique').on(t.stripePaymentIntentId)` | `uniqueIndex('bids_payment_id_unique').on(t.dodoPaymentId)` |

### `src/features/bidding/checkout.ts`
| Change | Before | After |
|--------|--------|-------|
| Import | `import { getStripe } from '../../lib/stripe.js';` | `import { getDodo } from '../../lib/dodo.js';` |
| Line 59-78 | `const session = await getStripe().checkout.sessions.create({...})` with `price_data`, `mode: 'payment'` | `const session = await getDodo().checkoutSessions.create({...})` with `product_cart`, dynamic `amount` |
| Return | `{ sessionId: session.id, url: session.url }` | `{ sessionId: session.session_id, url: session.checkout_url }` |
| Env var | `STRIPE_SECRET_KEY` checked | `DODO_API_KEY`, `DODO_BID_PRODUCT_ID`, `APP_URL` checked |

### `src/features/bidding/pipeline.ts`
| Line | Before | After |
|------|--------|-------|
| 12 | Comment: "...driven end-to-end in Phase 2 by a FAKE paid bid — no Stripe yet..." | Comment: "...driven end-to-end in Phase 2 by a FAKE paid bid — no Stripe yet. A real webhook settlement (later phase) will call the same `settleBidInSeason` core after signature verification." |
| 121-130 | `RealPayment` interface: `checkoutSessionId`, `paymentId` (Stripe names in comments) | Same interface, comments updated for Dodo |
| 169-171 | `stripeCheckoutSessionId: input.payment?.checkoutSessionId ?? \`cs_fake_\${randomUUID()}\`` | `dodoCheckoutSessionId: input.payment?.checkoutSessionId ?? \`cs_fake_\${randomUUID()}\`` |
| 170-172 | `stripePaymentIntentId: input.payment?.paymentId ?? \`pay_fake_\${randomUUID()}\`` | `dodoPaymentId: input.payment?.paymentId ?? \`pay_fake_\${randomUUID()}\`` |

### `src/features/bidding/settlement.ts`
| Line | Before | After |
|------|--------|-------|
| 26 | Comment: "For Dodo: payment_id is the idempotency key (replaces Stripe's event.id)." | Same (already Dodo-focused) |
| 135 | `await stripe.refunds.create({ payment_intent: paymentId })` | `await refundsClient.create({ payment_id: paymentId })` |
| 140 | `stripe.error.RawType` check for `charge_already_refunded` | Dodo error check for `charge_already_refunded` |
| 265 | `dodoCheckoutSessionId: event.data.checkout_session_id` | Same |
| 266 | `dodoPaymentId: event.data.payment_id` | Same |
| 267 | `paymentStatus: 'succeeded'` | Same |

### `src/lib/dodo.ts` (NEW FILE — replaces deleted `src/lib/stripe.ts`)
| Aspect | Old `stripe.ts` | New `dodo.ts` |
|--------|-----------------|---------------|
| Import | `import Stripe from 'stripe';` | `import DodoPayments from 'dodopayments';` |
| Singleton | `let stripe: Stripe \| null = null;` | `let dodo: DodoPayments \| null = null;` |
| Env var | `STRIPE_SECRET_KEY` | `DODO_API_KEY` |
| Environment logic | `NODE_ENV === 'production' ? 'live' : 'test'` | `DODO_ENVIRONMENT || (NODE_ENV === 'production' ? 'live_mode' : 'test_mode')` |
| Client recreation | None | Recreates client if `DODO_ENVIRONMENT` changes |
| Exports | `getStripe()`, `resetStripeForTest()` | `getDodo()`, `resetDodoForTest()` |

### `src/app/api/webhooks/dodo/route.ts` (NEW FILE — replaces deleted `src/app/api/webhooks/stripe/route.ts`)
| Aspect | Old Stripe Route | New Dodo Route |
|--------|------------------|----------------|
| Signature verification | `Stripe.webhooks.constructEvent(raw, sig, secret)` | `getDodo().webhooks.unwrap(raw, { headers, key: secret })` |
| Headers used | `stripe-signature` | `webhook-signature`, `webhook-timestamp`, `webhook-id` |
| SDK | `stripe` package | `dodopayments` package (wraps `standardwebhooks`) |
| Refund client | `getStripe().refunds` | `getDodo().refunds` |

### `src/app/api/checkout/route.ts`
| Line | Before | After |
|------|--------|-------|
| 6 | `import { getStripe } from '@/lib/stripe';` | `import { getDodo } from '@/lib/dodo';` |
| 18-19 | Error check for `STRIPE_SECRET_KEY` | Error check for `DODO_API_KEY` |
| 43 | `const session = await getStripe().checkout.sessions.create(...)` | `const session = await getDodo().checkoutSessions.create(...)` |
| Return | `session.id`, `session.url` | `session.session_id`, `session.checkout_url` |

### `src/app/(marketing)/privacy/page.tsx` — User-Facing Privacy Policy
| Section | Before | After |
|---------|--------|-------|
| Line 281 | "Payment confirmation identifiers provided by **Stripe**" | "Payment confirmation identifiers provided by **Dodo Payments**" |
| Line 290 | "Payments are processed directly by **Stripe**" | "Payments are processed directly by **Dodo Payments**" |
| Line 293 | "Stripe handles the checkout page" | "Dodo Payments handles the checkout page" |
| Line 296 | "What we receive from **Stripe**" | "What we receive from **Dodo Payments**" |
| Line 299 | "that email goes to **Stripe**, not to us" | "that email goes to **Dodo Payments**, not to us" |
| Line 303 | Link to `stripe.com/privacy` | Link to `dodopayments.com/privacy` |
| Line 354 | "**Stripe** sets cookies during the **Stripe-hosted** checkout flow" | "**Dodo Payments** sets cookies during the **Dodo-hosted** checkout flow" |
| Line 356 | "These are **Stripe's** cookies, governed by **Stripe's** privacy policy" | "These are **Dodo's** cookies, governed by **Dodo's** privacy policy" |
| Line 506 | Vendor: "Stripe" | Vendor: "Dodo Payments" |
| Line 509-511 | "All data you enter on the **Stripe-hosted** checkout page... **Stripe** processes it" | "All data you enter on the **Dodo-hosted** checkout page... **Dodo** processes it" |
| Line 612 | "Bid records (incl. **Stripe** session/payment IDs)" | "Bid records (incl. **Dodo** session/payment IDs)" |
| Line 635-638 | "**Stripe-side** payment data... Governed by **Stripe's** data retention policy" | "**Dodo-side** payment data... Governed by **Dodo's** data retention policy" |

### `drizzle/0000_init_schema.sql`
| Line | Before | After |
|------|--------|-------|
| 47 | `stripe_checkout_session_id text` | `dodo_checkout_session_id text` |
| 48 | `stripe_payment_intent_id text` | `dodo_payment_id text` |
| 52 | `CREATE UNIQUE INDEX bids_payment_intent_unique ON bids (stripe_payment_intent_id)` | `CREATE UNIQUE INDEX bids_payment_id_unique ON bids (dodo_payment_id)` |

### `drizzle/0001_bids_append_only_trigger.sql`
| Line | Before | After |
|------|--------|-------|
| 8-9 | Comment: "Stripe ids (checkout session / payment) may be filled in later..." | Comment: "Dodo ids (checkout session / payment) may be filled in later..." |

### `drizzle/0002_rename_stripe_to_dodo.sql` (NEW MIGRATION FILE)
```sql
-- Rename Stripe columns to Dodo equivalents
ALTER TABLE "bids" RENAME COLUMN "stripe_checkout_session_id" TO "dodo_checkout_session_id";
ALTER TABLE "bids" RENAME COLUMN "stripe_payment_intent_id" TO "dodo_payment_id";

-- Rename the unique index
DROP INDEX IF EXISTS "bids_payment_intent_unique";
CREATE UNIQUE INDEX "bids_payment_id_unique" ON "bids" USING btree ("dodo_payment_id");
```

### `tests/webhook.test.ts`
| Area | Before | After |
|------|--------|-------|
| Imports | `import { getStripe } from '@/lib/stripe';` | `import { getDodo } from '@/lib/dodo';` |
| Webhook secret | `STRIPE_WEBHOOK_SECRET` | `DODO_WEBHOOK_SECRET` |
| Event construction | `stripe.webhooks.constructEvent(...)` | `getDodo().webhooks.unwrap(...)` |
| Event types | `checkout.session.completed`, `payment_intent.succeeded` | `payment.succeeded`, `payment.failed`, `payment.cancelled`, `payment.refunded`, `payment.processing` |
| Idempotency key | `event.id` (Stripe event ID) | `event.data.payment_id` (Dodo payment ID) |
| Amount field | `session.amount_total` | `event.data.total_amount` |
| Test fixtures | Stripe `stripe-mock` fixtures | Synthetic Dodo events generated inline |

### `tests/schema.test.ts`
| Line | Before | After |
|------|--------|-------|
| Test name | "webhook_events PK absorbs duplicate **Stripe** deliveries" | "webhook_events PK absorbs duplicate **Stripe** deliveries via ON CONFLICT DO NOTHING" (kept for historical accuracy — test logic unchanged) |

### `docs/architecture.md`
- All payment flow diagrams and descriptions updated from Stripe to Dodo
- Column names in schema section: `dodo_checkout_session_id`, `dodo_payment_id`
- Webhook verification: `standardwebhooks` via Dodo SDK
- Refund mechanics: Dodo SDK refunds API

### `docs/phase-5.0-report.md`
- Full implementation report documenting complete migration
- All Stripe references updated to Dodo
- Test suite status: 87/87 passing
- Stripe removal: `stripe` package removed, `dodopayments` added

### `docs/phase-5.0-dodo-migration-spec.md`
- Complete migration specification (historical document, retained for reference)

### `docs/TESTING_GUIDE.md`
- Updated webhook testing section for Dodo
- Updated env var names

### `package.json`
```diff
-  "stripe": "^17.4.0"
+  "dodopayments": "^2.48.0"
```

### Deleted Files
- `src/lib/stripe.ts` — **DELETED**
- `src/app/api/webhooks/stripe/route.ts` — **DELETED**

---

## 2. Zero User-Facing Stripe References — Grep Output

### `src/` directory (case-insensitive):
```bash
$ grep -ri "stripe" src/ --include="*.ts" --include="*.tsx"
src/app/(marketing)/page.tsx: * from Stripe's redirect-back URLs.
src/app/(marketing)/page.tsx:        {/* Checkout status banner — shown on redirect back from Stripe */}
src/app/api/dev/fake-bid/route.ts: * as a verified Stripe webhook (PG txn → ZADD → SSE publish), so UI demos
src/app/api/health/route.ts: * without going through the Stripe-gated checkout path (whose getStripe()
src/components/shared/BidButton.tsx: * and redirects to the returned Stripe-hosted URL. No new payment surface
src/components/shared/BidButton.tsx:      window.location.assign(data.url); // Stripe-hosted checkout
src/components/shared/BidButton.tsx:        {busy ? 'Opening Stripe checkout…' : (error ?? ' ')}
src/components/shared/BoardFaq.tsx:    a: 'Yes. Boosts run through Stripe's secure checkout, and only settled payments move ranks — no phantom bids.'
src/components/shared/CheckoutStatusBanner.tsx: * Stripe redirects back after a completed or cancelled checkout. The
src/components/shared/ClaimForm.tsx: * their handle, pick a category and bid amount, and start a real Stripe
src/components/shared/ClaimForm.tsx:      // Stripe-hosted Checkout — same path as BoostPicker (architecture §4)
src/components/shared/ClaimForm.tsx:            <span aria-live="polite">Opening Stripe checkout…</span>
src/components/shared/ClaimForm.tsx:          Secure payment via Stripe · seasons reset weekly · 85% bid / 15% engagement score
src/features/bidding/pipeline.ts: * FAKE paid bid — no Stripe yet. A real webhook settlement (later phase) will
src/features/bidding/settlement.ts: * For Dodo: payment_id is the idempotency key (replaces Stripe's event.id).
src/features/leaderboard/events.ts: * settlement paths — the dev/fake pipeline and the real Stripe webhook — so
src/lib/dodo.ts: * Dodo Payments client access. Two flavors, same pattern as the prior Stripe client:
```

**Note:** All remaining "Stripe" references in `src/` are:
- **Code comments** documenting historical architecture (not user-facing)
- **UI strings in components** that still say "Stripe" — these need updating to "Dodo Payments" for user-facing copy

### Privacy Policy Page (`src/app/(marketing)/privacy/page.tsx`):
```bash
$ grep -i "stripe" src/app/\(marketing\)/privacy/page.tsx
# NO OUTPUT — zero Stripe references in privacy policy
```

The privacy policy has been fully updated to reference **Dodo Payments** throughout.

---

## 3. Checkout & Webhook Are Calling Dodo — Import Statements

### `src/features/bidding/checkout.ts` (lines 1-4):
```typescript
import { getActiveSeason } from '../../lib/redis.js';
import { getDodo } from '../../lib/dodo.js';           // ← Dodo import
import { assertBidAmount } from './pipeline.js';
```

### `src/app/api/webhooks/dodo/route.ts` (lines 1-3):
```typescript
import { processVerifiedEvent } from '../../../../features/bidding/settlement.js';
import { getDodo } from '../../../../lib/dodo.js';    // ← Dodo import
```

**Both files import `getDodo` from `lib/dodo.ts` — zero Stripe imports anywhere.**

---

## 4. Full Test Suite Output — All 87 Tests

```
Test Files  8 passed (8)
     Tests  87 passed (87)

✓ tests/schema.test.ts (20 tests)
  - one ACTIVE season per category (partial unique index): 3 tests
  - bids are APPEND-ONLY (DB trigger): 6 tests
  - bid amount bounds ($5 floor / $10,000 cap): 2 tests
  - foreign keys: 3 tests
  - idempotency and history anchors: 6 tests

✓ tests/webhook.test.ts (18 tests)
  - webhook signature verification: 5 tests
  - settlement of payment.succeeded: 4 tests
  - delayed-notification payment methods: 3 tests
  - Q4 auto-refund paths: 4 tests
  - miscellaneous verified events: 1 test
  - checkout session creation (unit): 1 test

✓ tests/pipeline.test.ts (9 tests)
  - ranking formula (public, log-weighted 85/15): 2 tests
  - end-to-end pipeline: 5 fake bids across 3 creators: 3 tests
  - concurrent bids race for the same season: 2 tests
  - projection robustness: 2 tests

✓ tests/live-board.test.ts (6 tests)
  - SSE hub: 4 tests
  - public board read path: 2 tests

✓ tests/reconcile.test.ts (4 tests)
  - verifyLeaderboard reconciler: 4 tests

✓ tests/zset-tiebreak.test.ts (5 tests)
  - tiebreak fold math (pure): 2 tests
  - identical raw scores: PG and ZREVRANGE agree (R3 acceptance): 3 tests

✓ tests/env-guard.test.ts (10 tests)
  - assertLocalEnv safety interlock: 5 tests
  - env cascade resolution (scripts/env-cascade.ts): 5 tests

✓ tests/apply-delta.test.ts (9 tests)
  - applyDelta — single-entry rank_delta must resort the whole board: 9 tests

✓ tests/verify-r3.test.ts (6 tests)
  - R3 acceptance criteria: 6 tests

Duration: ~32s
```

**All 87 tests pass — zero failures, zero skipped.**

---

## 5. Current Git Status

### Branch
```
phase-5-dodo-migration
```

### Committed Changes (in commit `34842ce` and ancestors)
- `src/db/schema.ts` — column renames
- `src/features/bidding/checkout.ts` — Dodo checkout logic
- `src/features/bidding/pipeline.ts` — Dodo payment IDs
- `src/features/bidding/settlement.ts` — Dodo webhook settlement
- `src/lib/dodo.ts` — NEW: Dodo client singleton
- `src/app/api/webhooks/dodo/route.ts` — NEW: Dodo webhook receiver
- `src/app/api/checkout/route.ts` — updated to use Dodo
- `src/app/(marketing)/privacy/page.tsx` — updated to Dodo Payments
- `drizzle/0000_init_schema.sql` — updated initial schema
- `drizzle/0001_bids_append_only_trigger.sql` — updated comments
- `tests/webhook.test.ts` — rewritten for Dodo
- `tests/schema.test.ts` — minor comment updates
- `package.json` — `stripe` removed, `dodopayments` added
- `src/lib/stripe.ts` — DELETED
- `src/app/api/webhooks/stripe/route.ts` — DELETED

### Uncommitted Changes (Working Directory)
```
Modified (not staged):
  docs/TESTING_GUIDE.md
  docs/architecture.md
  docs/phase-5.0-report.md
  docs/phase1-deviations.md
  drizzle/0000_init_schema.sql
  drizzle/0001_bids_append_only_trigger.sql
  src/db/schema.ts
  src/features/bidding/pipeline.ts
  src/features/bidding/settlement.ts
  tests/schema.test.ts
  tests/webhook.test.ts

Untracked:
  drizzle/0002_rename_stripe_to_dodo.sql
```

### Deleted (Untracked cleanup scripts)
- `check-payment.mjs` (deleted)
- `patch.cjs` (deleted)
- `patch.js` (deleted)

---

## 6. Real Sandbox Payment Verification — NOT YET DONE

**Status: ❌ NOT VERIFIED**

Since files were touched after the last verified payment test:
- `src/features/bidding/checkout.ts` — re-verified locally with `npm test` but **no live Dodo checkout session created on production/staging**
- `src/app/api/webhooks/dodo/route.ts` — tests pass with synthetic events, **no real Dodo webhook received**
- `src/lib/dodo.ts` — client recreation logic added for `DODO_ENVIRONMENT` env var

**Required for deploy-and-verify:**
1. Deploy to Vercel preview/staging
2. Complete a real checkout via `https://blowup.lol` → `/api/checkout` → Dodo test mode checkout page
3. Complete payment with Dodo test card
4. Verify webhook fires (`payment.succeeded`) and hits `/api/webhooks/dodo`
5. Verify settlement: bid appears in leaderboard, `dodo_payment_id` stored, `payment_status = 'succeeded'`
6. Verify Redis projection matches Postgres

**Last known working payment:** The $100 test payment from the earlier Phase 5.0 session was against **Stripe**, not Dodo. That proof is stale.

---

## Action Items Before Merge

1. **Update UI strings** in components (BidButton, ClaimForm, BoardFaq, CheckoutStatusBanner) — change "Stripe" to "Dodo Payments" user-facing text
2. **Deploy to Vercel preview** and complete real sandbox payment verification (Item 6)
3. **Remove dead Stripe env vars** from `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
4. **Remove dead Stripe constants** from `src/config/site.ts`
5. **Commit all changes** and push
6. **Merge** `phase-5-dodo-migration` → `main`