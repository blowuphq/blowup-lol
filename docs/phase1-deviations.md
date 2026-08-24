# Phase 1 — Deviations from the Approved Architecture

Reference: `docs/architecture.md` (v1.0 APPROVED 2026-08-24) · Implementation checkpoint: commit
`1466402 feat(db): implement Phase 1 database foundation`

Complete list of every point where the Phase 1 implementation differs from the approved
architecture doc. Three deviations total; each was made deliberately and is documented here
for approval review.

---

## Deviation 1 — Append-only bids enforced via DB trigger + payment-status transition whitelist

**What changed:** The approved doc declares bids append-only and permits payment_status
lifecycle transitions (§0: "INSERT-only except payment_status lifecycle transitions"; §4:
transition checks), but does not specify database-level enforcement — it left transition
validation to the application layer. Implemented instead as a `BEFORE UPDATE OR DELETE`
trigger (`bids_append_only`, migration `drizzle/0001_bids_append_only_trigger.sql`) that:

- raises an exception on any `DELETE`;
- blocks updates to immutable financial-history columns: `amount_cents`, `creator_id`,
  `campaign_id`, `season_id`, `currency`, `created_at`;
- permits only whitelisted transitions: `pending → succeeded | failed` and
  `succeeded → refunded`; anything else (e.g. `failed → succeeded`, `succeeded → pending`)
  raises;
- auto-stamps `status_updated_at` on every legal transition;
- leaves Stripe ids (`stripe_checkout_session_id`, `stripe_payment_intent_id`) writable,
  since they are lifecycle bookkeeping filled in later, not financial history.

**Why:** The definition-of-done demanded tests proving "bid rows cannot be updated after
insert," while the approved architecture requires status transitions for any bid to ever
settle. A blanket no-update rule would make settlement impossible; protecting financial-
history columns while allowing whitelisted lifecycle moves reconciles both requirements.

**Net effect vs. doc: strictly stronger.** The transition whitelist that §4 assigned to the
application layer is now also enforced by the database and cannot be bypassed by app bugs.

---

## Deviation 2 — Bid amount CHECK widened to `$5–$10,000` (was $5 floor only)

**What changed:** `bids_amount_range_check` enforces `amount_cents BETWEEN 500 AND 1000000`
(min $5.00 / max $10,000.00 per single bid), replacing the doc's original `>= 500`.

**Why:** Product-owner instruction ("add a $10,000 max per single bid — sanity cap, prevents
a single Stripe refund/dispute nightmare and keeps the season contestable"). The architecture
doc was updated first so code follows doc: §2 constraint line, §3 tier paragraph, §8
amount-integrity bullet, Q2 Decisions Record entry, and changelog item 5 all reflect the cap.

---

## Deviation 3 — Local/dev connections use `node-postgres`, not the Neon serverless driver

**What changed:** `drizzle.config.ts`, `scripts/seed.ts`, and `tests/schema.test.ts` connect
via `pg` (node-postgres) instead of the Neon serverless driver named in §1 (`lib/db.ts`).

**Why:** Neon's serverless driver communicates over WebSockets and cannot reach a local
Docker Postgres (the `blowup-pg` dev container used for Phase 1 verification). Zero impact on
schema, migrations, or SQL: every table, column, index, constraint, and trigger matches the
approved doc exactly. Swapping drivers when pointing at production Neon is a one-line change.

**APPROVED WITH CONDITION (2026-08-24):** the "one-line change" claim is NOT to be assumed at
deploy time. When the project first targets real Neon, explicitly verify: driver swap compiles
and connects, transactions behave identically (advisory locks + `SUM` subqueries), and the
bids append-only trigger fires under the serverless driver's connection model. Add this to the
production bring-up checklist before first deploy.

---

## Explicitly NOT deviations

Verified against the approved doc and implemented verbatim:

- `categories` lookup table (smallint identity PK, immutable slug, `active` flag) — not an enum;
  launch seed = Tech / Gaming / Education via INSERT.
- All column names, types, defaults, and nullability as specced (bigint cents, timestamptz,
  numeric(14,4) score, enums).
- Denormalized `season_id` on bids/clicks/activities (F2/F5).
- Every index: `(category_id)`, season partial unique indexes, campaign rank/score indexes,
  click dedupe indexes, activity feed index, pending-bid partial index.
- FK actions: RESTRICT everywhere.
- `webhook_events` text PK (Stripe event id); `season_results` UNIQUE `(season_id, creator_id)`.

Unbuilt by design (out of Phase 1 scope): the F1 nightly `SUM(bids)` reconciliation job is
Inngest work, deferred to the phase where Inngest functions are introduced.
