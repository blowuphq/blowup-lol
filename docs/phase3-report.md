# Phase 3 Report — Stripe Checkout + Verified Webhook Settlement

Status: DELIVERED 2026-08-24 · Branch: `phase-3-stripe-payments` ·
Commits: `f983e5c` (implementation), `dcfe4d4` (chore) ·
Tests: **48/48 green** (20 schema + 9 pipeline + 19 webhook) ·
`next build` clean · built server smoke-tested live

Phase 3 replaces the fake payment ids of Phase 2 with the real money path:
Stripe-hosted Checkout creates the payment intent, and ONLY a signature-verified
webhook can turn paid money into rank, totals, activity rows, and Redis
projection writes. Nothing else changed — no UI (beyond one disclosed stub
page), no SSE, no reconciler (that is Phase 3.5 by owner decision).

## The money path, end to end

```text
bidder -> POST /api/checkout        validate bounds/handle, resolve ACTIVE season,
                                    create Stripe Checkout Session (identity in metadata)
        -> Stripe-hosted page       bidder pays; Stripe holds the card data (PCI stays theirs)
        -> POST /api/webhooks/stripe
             raw body + stripe-signature header
             -> Stripe.webhooks.constructEvent   (SDK verification; no API key needed)
             -> processVerifiedEvent()
                  webhook_events insert-first claim (crash-resumable)
                  ONE PG transaction:
                    fresh active-season resolution
                      -> rolled over / none? Q4 AUTO-REFUND
                    get-or-create creator (UCANON_ id) + campaign
                    append-only Bid born 'pending'
                    trigger-whitelisted pending->succeeded flip
                    SUM-derived total -> score -> season rank recompute
                      (advisory lock) -> activity row
                    mark event processed (atomic with settlement)
                  COMMIT
                  post-commit: safeZadd to Redis (fail-open, never blocks truth)
```

Invariants carried over from architecture §3/§4 and Phases 1–2: Postgres is the
sole source of truth for money and rank; Bid rows are append-only; totals are
derived from summed bids; PG commits before Redis is touched; client redirects
and success pages are never trusted.

## What was built

1. **`POST /api/checkout`** (`src/app/api/checkout/route.ts` +
   `src/features/bidding/checkout.ts`) — validates amount bounds ($5–$10,000)
   and YouTube-style handle (normalized to `@lowercase`), resolves the active
   season *before* redirecting the bidder, then creates a Stripe-hosted
   Checkout Session. Dynamic payment methods (no `payment_method_types`, per
   Stripe best practices), USD-only V1, `integration_identifier` tag.
   Identity rides to the webhook in metadata (`categorySlug`, `handle`,
   optional display name, and the **intended `seasonId`**). The amount is
   deliberately NOT part of the trusted metadata contract at settlement time.

2. **`POST /api/webhooks/stripe`** (`src/app/api/webhooks/stripe/route.ts`) —
   reads the RAW body before any parsing and verifies via **Stripe's own
   static `Stripe.webhooks.constructEvent`** — battle-tested code rather than
   hand-rolled HMAC, and it needs no API key, so verification works even where
   `STRIPE_SECRET_KEY` is unset. Unverified requests get 400; verified events
   always get 200 (whatever the business outcome); infrastructure errors get
   500 so Stripe's at-least-once redelivery heals them.

3. **Settlement core** (`src/features/bidding/settlement.ts`) — every money
   mutation lives in ONE Postgres transaction (details in the flow above).
   Amount always comes from Stripe (`session.amount_total`), never from
   metadata. Season resolution happens fresh INSIDE the transaction — caches
   and pointers are never consulted for source-of-truth decisions.

4. **Delayed-notification branches** — per Stripe best practices, fulfillment
   is gated on payment state, not just the event name: `checkout.session.completed`
   while still `unpaid` waits (`awaiting_payment`); the later outcome arrives as
   `checkout.session.async_payment_succeeded` (settles) or
   `checkout.session.async_payment_failed` (recorded, nothing settled, nothing
   refunded — the money was never captured).

5. **Idempotency under at-least-once delivery** — two independent guards:
   (a) the `webhook_events` insert-first gate with a tri-state meaning
   (fresh receipt → run; unprocessed leftover → a previous attempt crashed
   mid-flight, RESUME; processed → true duplicate, no-op); (b) the
   `bids.stripe_payment_intent_id` unique index backstops double settlement if
   a different event id ever carries the same PaymentIntent.

6. **Pipeline refactor** (`src/features/bidding/pipeline.ts`, minimal) —
   `getOrCreateCreator` now takes an explicit channel id (fake flow passes
   `UCFAKE_…`, real flow derives deterministic `UCANON_…` from the handle);
   `settlePaidBid` accepts real Stripe ids plus `bornPending`, which inserts
   the bid as pending and flips it through the trigger-whitelisted transition
   inside the same transaction. Phase 2 fake-bid behavior is unchanged and all
   29 prior tests still pass untouched.

## Decisions requiring owner review (deviations & disclosures)

1. **Next.js 15 → Next.js 16.3.2.** Next 15 cannot run under this repo's
   TypeScript 7 standard: its type-check stage requires tsc JavaScript APIs
   that the TS7 native compiler removed (build error quoted: "Install
   TypeScript 6 … or upgrade to a Next.js v16.2.11 or later"). We upgraded
   Next rather than downgrade TypeScript. This deviates from the approved
   doc's "Next.js 15" pin — architecture.md should record it if accepted.

2. **Webpack pipeline pinned; Turbopack bypassed.** Our NodeNext-style
   `.js`-suffixed relative imports don't resolve under Turbopack (Next 16's
   default bundler has no `extensionAlias` equivalent). `package.json` scripts
   therefore pin `next dev/build --webpack`, and `next.config.mjs` sets
   `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }`. Zero source
   churn; mechanical migration to Turbopack remains possible later if we ever
   drop the suffix convention.

3. **Q4 auto-refund implemented NOW, not deferred.** Verified webhooks force
   the question "what if the season ended between checkout and settlement?"
   Refunds fire when: no active season exists for the slug; the intended
   season no longer matches the active one (rollover); the paid amount is
   out-of-bounds despite a valid signature (defense in depth); or required
   metadata is missing/unattributable. Refund calls tolerate
   `charge_already_refunded`, so crash-resume redelivery is safe. If a refund
   is required but `STRIPE_SECRET_KEY` is unset, the route answers 500 and
   leaves the event unprocessed — deliberate: retry loudly until configured,
   never silently keep money owed back to a bidder.

4. **No database write at checkout time.** Creating a Checkout Session writes
   nothing — no pending bid row exists until a VERIFIED webhook settles it.
   This keeps unauthenticated checkout attempts from spamming tables, at the
   cost of not recording abandoned intents (accepted for V1). The
   pending→succeeded lifecycle still runs through the append-only trigger,
   atomically within the settlement transaction.

5. **Minimal root page added** (`src/app/page.tsx`, one heading) so Stripe's
   success/cancel redirect lands on a real response instead of a 404 during
   demos. Borderline against the "no UI" scope line — disclosed here; trivial
   to delete if you rule it out of scope.

6. **Anonymous identity scheme.** With OAuth out of scope (V1 rule) and no
   YouTube API yet, a verified checkout mints a stable `UCANON_<HANDLE>`
   channel id derived from the normalized handle. When real channel lookup
   arrives, creators can be re-keyed without touching the money path.

7. **Dependency posture.** Production keys should be RESTRICTED (`rk_`,
   noted in `.env.example`). `npm audit` reports 7 vulnerabilities (4 moderate,
   3 high) in transitive dependencies of the new Next/React tree — NOT
   auto-"fixed" (`audit fix --force` does major bumps); flagged for your call.

## Issues found & fixed during Phase 3 (permanent record)

1. **Retry-poisoning idempotency flaw (self-caught pre-commit).** The first
   settlement draft committed the dedupe gate BEFORE branching, so a transient
   failure would make Stripe's redelivery land as "duplicate" and the
   settlement would be skipped forever. Restructured around tri-state events:
   unprocessed receipts RESUME instead of skip; settlement marks processed
   atomically with itself; refunds tolerate already-refunded replays.
2. **Route/test contract mismatch (caught by the new suite).** The webhook
   route returned `outcome: outcome.kind` (a bare string) while every consumer
   expected the object — 8 failures pointed straight at it; fixed to return
   the whole discriminable outcome.
3. **Season-resolution regression (self-caught).** A rewrite draft dropped the
   SQL-level `status='active'` filter and used an unordered `.limit(2)` —
   nondeterministic once historical seasons exist. Restored the single
   filtered query backed by the partial unique index.
4. **Toolchain collisions** documented above (items 1–2): TS7 × Next 15, and
   NodeNext `.js` imports × Turbopack.

## Verification evidence

Full suite (all three files, sequential execution):

```text
 Test Files  3 passed (3)
      Tests  48 passed (48)
```

Production build (webpack pipeline, Next 16.3.2):

```text
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/checkout
└ ƒ /api/webhooks/stripe
```

Live smoke test of the BUILT server (`next start`):

```text
--- GET /                                          -> 200
--- POST /api/checkout (no Stripe key configured)  -> {"error":"payment system unavailable"}
--- POST /api/webhooks/stripe (no signature)       -> 400
```

Webhook behavior is exercised by synthetic signed events driving the REAL
route handler (`tests/webhook.test.ts`, 19 tests): bad/tampered/stale/missing
signatures rejected with zero writes; end-to-end settlement with real
`cs_`/`pi_` ids and trigger-stamped transition; duplicate-event no-op;
double-settlement block via unique index; crashed-attempt resume;
completed-unpaid / async succeeded / async failed branches; all three Q4
refund reasons incl. already-refunded tolerance; checkout creation unit tests
(metadata normalization, bounds-before-Stripe, dynamic payment methods).

## Not yet proven

Everything requiring real Stripe-side participation:

- A live Checkout completion against Stripe test mode, with
  `stripe listen --forward-to localhost:3000/api/webhooks/stripe` forwarding a
  REAL signed event into this handler. Synthetic events replicate Stripe's
  signing scheme exactly, but the acceptance step closes the loop.
- End-to-end refund against real Stripe money (the refund paths are proven
  against injected fakes; `charge_already_refunded` semantics come from the
  SDK's documented error surface).
- Deploy-time verifications already on the books: the Neon serverless driver
  swap (approved-with-condition from Phase 1) and Upstash-for-Redis
  compatibility (architecture note) remain outstanding until deployment.

## Scope discipline

No subscriptions, no customer objects, no dashboard, no SSE, no reconciler
(Phase 3.5), no score-tiebreak change (Phase 3.5), no YouTube API. Additions
beyond the letter of the scope: the stub root page (item 5 above) and the Q4
refund implementation (item 3 — forced by webhook settlement reality, already
an approved architecture decision). Everything else is checkout + verified
webhook settlement, exactly as scoped.
