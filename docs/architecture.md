# Blowup.io — Architecture

**Status: v1.0 — APPROVED 2026-08-24.** All nine sections approved in writing by product owner; overrides incorporated (see Decisions Record). This is the canonical plan. Implementation proceeds phase-by-phase only on explicit go-ahead. **Phase 1 (database schema implementation) awaits approval — no implementation code exists yet.**

---

## 0. Ground rules honored

| Fixed product rule | How this design honors it |
|---|---|
| Postgres = source of truth for money & rank; Redis = read-only projection | Every money/rank mutation commits in a Postgres transaction **before** any Redis write. Nothing reads Redis to decide money state. Redis loss degrades reads; never corrupts money. |
| Payments confirmed only via verified Stripe webhook | Success redirect is display-only (§4). |
| Bid table append-only | INSERT-only except `payment_status` lifecycle transitions — status changes on audit rows, never mutations of financial history. Totals materialized inside the same transaction that appends the Bid; nightly reconciliation against `SUM(bids)` (F1). |
| Weekly season resets; permanent profile history; NO decay | `season_results` snapshots each season permanently; profile stats derived at read time. No decay logic exists anywhere in the system. |
| Public ranking formula (~80–90% $ / 10–20% engagement) | Formula lives in `lib/rank-formula.ts`, mirrored verbatim onto public `/how-ranking-works`, both fed from the same constants. |
| V1: no OAuth/login, no dashboard, no subscriptions, no AI, no CRM | Honored. Scope creep is flagged in-line throughout and tracked in the V1.1 Backlog. |

---

## 1. Directory / module architecture

Next.js **16.3.2** App Router (amended from "Next.js 15" pre-Phase-3 approval — TypeScript 7, this repo's standard, requires Next ≥16.2.11), TypeScript 7, feature-first modules. Three route groups = three shells.

> **Bundler note (2026-08-24):** the webpack pipeline is PINNED via `--webpack` in
> package.json scripts, with `resolve.extensionAlias = {'.js': ['.ts','.tsx','.js']}`
> in `next.config.mjs`. Turbopack (Next 16's default) cannot resolve NodeNext-style
> `.js`-suffixed imports into our `.ts` sources; webpack can. Config ships as
> `next.config.mjs` because Next 15-era TS-config loading also broke under TS7.
> Verified compatible with planned phases: Inngest (`inngest/next` serve handler,
> SDK ≥4.2.2) and SSE (Route Handler + `ReadableStream`, `force-dynamic`,
> `X-Accel-Buffering: no`).

```
src/
├── app/
│   ├── (marketing)/                  # static-ish public shell
│   │   ├── page.tsx                  # landing
│   │   ├── categories/page.tsx       # all active category boards index
│   │   └── how-ranking-works/page.tsx# PUBLIC FORMULA PAGE (same constants as scorer)
│   ├── (board)/
│   │   └── [category]/               # slug resolved against `categories` table
│   │       ├── page.tsx              # live leaderboard (SSR top-100 Redis, PG fallback)
│   │       └── creator/[handle]/page.tsx # profile: season history, best rank, all-time clicks
│   ├── checkout/
│   │   └── success/page.tsx          # DISPLAY-ONLY landing (polls status, writes nothing)
│   ├── api/
│   │   ├── webhooks/stripe/route.ts  # THE ONLY endpoint that moves money/rank from outside
│   │   ├── events/route.ts           # SSE stream: rank deltas + visitor count (CF: no buffering)
│   │   ├── clicks/[creatorId]/route.ts # signed redirect → YouTube, logs Click row
│   │   └── inngest/route.ts          # Inngest function handler
│   ├── layout.tsx
│   └── not-found.tsx
├── features/
│   ├── bidding/          # startCheckout action, tier validation, bid audit rows
│   ├── leaderboard/      # board reads (Redis→PG fallback), SSE hub, rank-delta payloads
│   ├── seasons/          # active-season resolution, rollover transaction
│   ├── activity/         # feed write (in-txn) + feed read API
│   ├── creators/         # YouTube Data API resolve+cache, provisional-creator path
│   └── clicks/           # dedupe, session hashing, ingest
├── lib/
│   ├── db.ts             # Drizzle client (Neon serverless driver, pooled)
│   ├── redis.ts          # Upstash REST client
│   ├── stripe.ts         # Stripe client + webhook secret handling
│   ├── youtube.ts        # Data API v3 wrapper w/ quota guard
│   ├── env.ts            # zod-validated process.env — boot fails loudly if incomplete
│   ├── rank-formula.ts   # SINGLE SOURCE OF TRUTH for scoring weights/constants
│   ├── sse.ts            # per-category event hub, Last-Event-ID ring buffer
│   └── ratelimit.ts      # Upstash sliding-window limiters
├── inngest/functions/
│   ├── seasonRollover.ts       # weekly cron
│   ├── driftWatch.ts           # rollover safety verification
│   ├── leaderboardReconcile.ts # Redis↔PG diff repair, every 5 min
│   └── enrichCreator.ts        # retry backfill when YouTube was down
├── components/ui/        # shadcn primitives
├── components/shared/    # LeaderboardRow, RankFlip (Framer Motion), ActivityTicker, VisitorCount
├── config/site.ts        # bid tiers, formula constants, misc site config (NOT the category list)
└── middleware.ts         # rate-limit pre-gate on POST routes only
```

Key structural decisions:
- **No `features/auth`** — V1 is anonymous (Decision Q1). Auth later slots in as one module + an `(account)` route group.
- **Categories come from the database, never from code** (Decision Q6): routes, validation, and Redis keys resolve slugs against the `categories` table. Code must contain no hardcoded category lists — grep-able invariant.
- **`rank-formula.ts` + `config/site.ts` imported by both the scorer and the explainer page**, so displayed ≠ executed is structurally impossible.
- Server Actions for all user mutations; API routes only for machines (webhook, SSE, click redirect).

---

## 2. Database schema (Drizzle / Postgres)

Money = bigint integer cents (`*_cents`). Timestamps = `timestamptz`. PKs uuid, except high-volume append tables (bigserial) and the small lookup table (smallint identity).

### Tables

**categories** *(lookup table — new categories are data inserts, never migrations)*
| Column | Type | Notes |
|---|---|---|
| id | smallint PK GENERATED ALWAYS AS IDENTITY | |
| slug | text UNIQUE NOT NULL | `'tech'`, `'gaming'`, … URL segment + Redis key segment. **Immutable once created** — treat as a stable identifier. |
| name | text NOT NULL | display name |
| active | boolean NOT NULL DEFAULT true | inactive ⇒ hidden from UI, rejects new campaigns |
| created_at | timestamptz DEFAULT now() | |

**Launch seed (plain INSERT, shipped with initial migration's seed step):** `(tech, Tech)`, `(gaming, Gaming)`, `(education, Education)` — all `active=true`.

**creators**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| youtube_channel_id | text UNIQUE NOT NULL | UCID (`UC…`) |
| handle | text NOT NULL UNIQUE | display @handle |
| name | text | |
| avatar_url | text | |
| subscriber_count | integer NULL | cached; NULL until YT enrichment succeeds |
| category_id | smallint NOT NULL FK→categories | replaces draft's `category text`; referential integrity, still pure data to extend |
| metadata_fetched_at | timestamptz NULL | staleness marker |
| created_at | timestamptz DEFAULT now() | |

Index: `(category_id)`. New submissions validated against **active** categories only.

**seasons**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | used inside Redis keys |
| category_id | smallint NOT NULL FK→categories | |
| starts_at / ends_at | timestamptz NOT NULL | UTC weekly window |
| status | enum('upcoming','active','ended') | |

Constraints: partial unique `(category_id) WHERE status='active'` — DB-level guarantee of exactly one active season per category. Unique `(category_id, starts_at)`.

**campaigns**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| creator_id | uuid FK→creators ON DELETE RESTRICT | |
| season_id | uuid FK→seasons ON DELETE RESTRICT | |
| bid_total_cents | bigint NOT NULL DEFAULT 0 | materialization, see F1 |
| unique_clicks | integer NOT NULL DEFAULT 0 | per-season deduped count |
| score | numeric(14,4) NOT NULL DEFAULT 0 | formula output, recomputed on events |
| rank | integer NULL | NULL until first succeeded bid |
| status | enum('live','ended') | |
| created_at / updated_at | timestamptz | |

Indexes: `(season_id, rank)`, `(season_id, score DESC)`, UNIQUE `(creator_id, season_id)`.

**bids** — APPEND-ONLY (INSERT + payment_status transitions only)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| creator_id | uuid FK→creators | denormalized for audit queries |
| campaign_id | uuid FK→campaigns | |
| season_id | uuid FK→seasons | denormalized (F2) — season audits need no join |
| amount_cents | bigint NOT NULL CHECK (amount_cents BETWEEN 500 AND 1000000) | min $5 / max $10,000 per bid (Decision Q2) |
| currency | char(3) DEFAULT 'USD' | V1 USD-only |
| stripe_checkout_session_id | text NULL | set at checkout creation |
| stripe_payment_intent_id | text NULL UNIQUE | idempotency anchor (F3) |
| payment_status | enum('pending','succeeded','failed','refunded') DEFAULT 'pending' | |
| created_at / status_updated_at | timestamptz | |

Indexes: `(campaign_id)`, `(created_at DESC)`, partial `(payment_status) WHERE payment_status='pending'`.
Refunds flip `payment_status='refunded'` (F4); derived totals sum non-refunded bids.

**clicks** — APPEND-ONLY
| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | high-volume |
| creator_id / campaign_id / season_id | uuid FKs | season_id denormalized (F5) |
| session_hash | text NOT NULL | HMAC(ip ‖ ua ‖ daily-salt) — no raw IP stored |
| referrer | text NULL | |
| created_at | timestamptz DEFAULT now() | |

Indexes: `(campaign_id, session_hash, created_at)` (dedupe), `(campaign_id, created_at)`.

**activities** — event log powering the public feed and rank history
| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| season_id | uuid FK→seasons | feed is per-board |
| creator_id | uuid FK→creators | |
| type | enum('bid','rank_change','joined_board') | |
| previous_rank / new_rank | integer NULL | |
| amount_cents | bigint NULL | |
| created_at | timestamptz DEFAULT now() | |

Index: `(season_id, created_at DESC)`.

**webhook_events**
| Column | Type |
|---|---|
| id | text PK = Stripe event ID |
| type | text |
| received_at / processed_at | timestamptz |

Insert-first idempotency gate (§4).

**season_results** — the immutable permanent-history record
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id / creator_id | uuid FKs, UNIQUE together | |
| final_rank | integer | NULL if never ranked |
| best_rank | integer NULL | best rank held during season |
| bid_total_cents | bigint | |
| unique_clicks | integer | |
| score | numeric(14,4) | final score |

Profile stats ("best rank ever," "weeks ranked," "lifetime clicks") derive at read time from `season_results` (MIN/COUNT/SUM). No mutable aggregate counters anywhere.

### Accepted interpretation flags (approved F1–F7)

- **F1** — `bid_total_cents` maintained only inside the txn appending the Bid row; nightly job reconciles vs `SUM(bids)` (detector — alarms, never silently fixes).
- **F2/F5** — denormalized `season_id` on bids/clicks/activities.
- **F3** — Stripe-only V1; unique PI id is the anchor.
- **F4** — refunds flip status; derivation filters them.
- **F6** — shares + verified badge deferred (no entity defined; badge needs a verifier policy).
- **F7** — anonymous bidding; Stripe Checkout email is the contact point.

---

## 3. Ranking lifecycle: bid submitted → UI updates

Public formula (displayed verbatim on `/how-ranking-works`):

```
score = W_BID · ln(1 + bid_total_dollars) + W_ENG · ln(1 + unique_clicks)
W_BID = 0.85      W_ENG = 0.15
tiebreak: lower rank wins earlier first-succeeded-bid createdAt
```

Log form: deterministic, monotonic, publicly explainable ("each doubling of spend adds equal points"), keeps engagement share meaningful whale-to-micro. Confirmed over linear (Q3).

**Bid tiers (Decision Q2):** `$5 / $25 / $100 / $500` + custom amount, **min $5, max $10,000 per single bid**. Client sends tier ids or a custom amount; dollar amounts always resolved/validated server-side. Entry price deliberately friction-low for 2K–100K-sub micro-creators; the $10k cap (added pre-Phase-1) bounds refund/dispute exposure and keeps a season contestable.

**Phase A — pre-payment** (Server Action `startCheckout`; no money moved):
1. zod-validate `{categorySlug, channelId|handle, tier|customAmount}`; rate-limit (§8).
2. Resolve category row by slug — must exist and be `active` (404 otherwise).
3. Resolve active season for category: Redis pointer `blowup:season:{slug}`, PG fallback.
4. Resolve/create Creator: YouTube lookup (24h Redis cache); degrade path if YT down (§7.3).
5. Get-or-create Campaign `(creatorId, seasonId)` — **lazily per season** (an empty board at week start is the product).
6. INSERT Bid `payment_status='pending'` + checkout session id (audit trail + abandoned-checkout analytics).
7. Create Stripe Checkout Session: `mode=payment`, amount server-set, `metadata={bidId, campaignId, creatorId, seasonId}`, Idempotency-Key on the API call.
8. Return hosted Checkout URL → redirect.

**Phase B — settlement** (webhook; the only trusted confirmation):
1. Raw-body POST → `constructEvent` signature verify (tolerance 300s). Invalid → 400, zero state touched.
2. `INSERT INTO webhook_events(id) … ON CONFLICT DO NOTHING` → conflict = duplicate delivery → 200 immediately.
3. `BEGIN`; `pg_advisory_xact_lock(seasonId)`.
4. Load Bid by `metadata.bidId`; assert legal `pending→succeeded` (else commit-noop, 200).
5. Set `payment_status='succeeded'`, store PI id.
6. `UPDATE campaigns SET bid_total_cents = bid_total_cents + :amount`.
7. Recompute `score`; new rank = `1 + COUNT(*) WHERE season_id=:s AND (score > :score OR (score = :score AND first_bid_created_at < :mine))`.
8. UPDATE `campaigns.rank`; INSERT `activities(bid/rank_change, prev, new, amount)`.
9. `COMMIT`.
10. After commit: `ZADD blowup:lb:{slug}:s{seasonId} score creatorId` (retry ×3), publish SSE `{type:'rank_delta', entries:[{creatorId,newRank,score}], activity:{…}}`. Redis failure never rolls back Postgres (§7.1).
11. 200 to Stripe (non-2xx pre-commit ⇒ Stripe retries; idempotency layers absorb it).

**Phase C — UI:**
- SSE clients apply delta; Framer Motion FLIP-animates rows. Reconnect replays via `Last-Event-ID`, then one fresh fetch.
- `/checkout/success?session_id=…` polls a read-only status endpoint. **Writes nothing, ever.**

Ordering invariant: **Postgres commit → Redis ZADD → SSE publish. Never reversed.**

---

## 4. Payment lifecycle & idempotency

Canonical path is §3 Phase A step 7 → Phase B. Specifics:

- **Trusted fields:** all money-affecting values come from server-written Checkout `metadata`, cross-checked against the event object (`amount_received` mismatch → Sentry alert + manual review, never auto-application).
- **Idempotency, three layers:**
  1. Stripe-side: Idempotency-Key on session creation (retries can't double-create sessions).
  2. Event-side: `webhook_events(event_id)` PK insert-first — duplicate deliveries no-op.
  3. Effect-side: UNIQUE `stripe_payment_intent_id` + strict transition check — even a *different* event referencing the same payment can't credit twice.
- **Out-of-order/duplicates:** handlers are transition-based, not command-based. Second `pending→succeeded` attempt is a no-op acked 200.
- **Refunds** (`charge.refunded`): `succeeded→refunded`, total/score/rank re-derived in the same txn pattern.
- **Failures** (`payment_intent.payment_failed`): `pending→failed`; no rank effect.
  *(Superseded by Phase 3 decision #4, same as the sweep note below: no Bid row
  exists at checkout time, so a failed-payment event has nothing to transition —
  the webhook correctly answers "ignored." Kept as harmless documentation of the
  trigger's whitelisted transitions; owner decision 2026-08-24.)*
  *(As implemented in Phase 3, no Bid row exists at checkout time at all — pending
  bids only occur mid-settlement-transaction — so there is nothing for an
  abandoned-checkout sweep to do. Superseded by Phase 3 decision #4: abandoned
  Checkout Sessions are Stripe's lifecycle to expire, not ours; the former daily
  Inngest sweep line was removed by owner decision 2026-08-24.)*
- **Season-boundary race:** webhook lands after season ended → auto-refund via Stripe API + activity note (Q4).
- Webhook route bypasses body parsing so the raw body reaches the verifier.

---

## 5. Season rollover (Inngest)

**Jobs:** `seasonRollover` — cron `5 0 * * 1` (Mondays 00:05 UTC, offset from :00 to dodge webhook noise). `driftWatch` — every 15 min during the first post-rollover hour (asserts exactly-one-ACTIVE-season/category; alerts otherwise). `leaderboardReconcile` — always-on 5-min (§6).

**`seasonRollover`, one transaction per category** (advisory lock held):
1. Verify active season `ends_at <= now()`; else skip (driftWatch owns anomalies).
2. **Snapshot:** INSERT `season_results` for every campaign with ≥1 succeeded bid: `final_rank`, `best_rank` (= MIN rank from activities), totals, score. Immutable permanent history.
3. Mark season + campaigns `ended`.
4. INSERT next season `(now() → now()+7d, 'active')` — partial unique index guarantees single-active.
5. COMMIT. Next week's Campaign rows are **not pre-created** — lazy on first bid.
6. Post-commit: new empty ZSET for `s{nextSeasonId}`, flip `blowup:season:{slug}` pointer, EXPIRE old leaderboard key at 35d.
7. Recap email fan-out — **deferred to V1.1, tracked as Backlog item B1** (see Backlog section).

Profile stats post-reset derive from `season_results` — survive resets forever, no decay code, nothing maintained.

---

## 6. Redis strategy (Upstash)

### Key scheme (slugs, per Decision Q6)

| Key | Type | TTL | Writer | Reader |
|---|---|---|---|---|
| `blowup:lb:{slug}:s{seasonId}` | ZSET (member=creatorId, score=tiebreak-adjusted score, R3) | 35d | webhook post-commit, reconciler | board SSR |
| `blowup:season:{slug}` | STRING (active seasonId) | none | rollover, app-boot fallback | all board paths |
| `blowup:visitors:{slug}` | STRING counter | 60s heartbeat | SSE hub | header widget |
| `blowup:cd:{campaignId}:{sessionHash}` | STRING "1" | 24h | click endpoint | click endpoint |
| `blowup:ytc:{channelId}` | JSON channel metadata | 24h | creator resolver | creator resolver |
| `rl:{scope}:{key}` | limiter buckets | window | actions/middleware | same |

Slugs (not uuid ids) keep keys human-greppable across environments; slugs are immutable by convention so keys never dangle.

### Cached vs always-Postgres

| Redis (fast path, safe to lose) | Always Postgres (authoritative) |
|---|---|
| Live board top-N renders | Any money figure on detail/profile pages |
| Visitor counts | Bid history, totals, ranks on profile pages |
| Click dedupe short-circuit | Click ledger + authoritative dedupe (PG checked on write) |
| YouTube metadata cache | Category/season/campaign state, rollover snapshots |
| Rate-limit windows | Activity feed history (Redis holds live tail only) |

### Invalidation model: write-through-after-commit + repair loops (no delete-invalidation)

1. Every scoring txn publishes new score to the ZSET immediately post-commit (§3.B10). The projected score is tiebreak-adjusted (`score − 1e-11 · firstBidOrdinal`, R3) so ZREVRANGE reproduces PG ordering even on byte-equal scores.
2. `leaderboardReconcile` (5 min, SHIPPED Phase 3.5): diffs each active season's FULL ZSET vs a pure-PG recomputation and repairs with targeted ZADD/ZREM — no advisory lock, read-only toward Postgres, safe next to settlement. Full-set diff replaces the top-50 sketch (boards are tiny at V1 scale, and stale members must never survive where SSE would broadcast them); targeted repairs replace a separate `rebuildLeaderboard` threshold — a fully wiped key is just N missing members to the same code path. On-demand: `npm run dev:reconcile -- <slug>`.
3. Board reads circuit-break to PG on Redis miss/error — outage degrades latency, never correctness.

---

## 7. Failure scenarios

**7.1 Webhook fires, Redis write fails.** Postgres already committed — money and rank correct and durable. The SSE payload carries ranks computed *inside* the txn, so connected viewers animate correctly even while the ZSET is stale. Heals via ≤5-min reconciler or next successful write-through. Worst case: cold visitor sees ≤5-minute-old board. Money never affected. (ZADD retried ×2; reconciler heals within one schedule interval.)

**7.2 Two bids race for the same rank.** Both webhooks enter txns; `pg_advisory_xact_lock(seasonId)` serializes them. The second computes rank *after* the first commits → distinct ranks (e.g., 5 then 6), both activity rows truthful, two SSE hops animated. Score ties break deterministically by earliest leading bid under the lock; documented publicly.

**7.3 YouTube API down during submission.** Submission **degrades, doesn't block**: Creator row created from user-provided handle/name, `subscriber_count=NULL`, `metadata_fetched_at=NULL`; checkout proceeds (the payment itself filters spam better than any API). `enrichCreator` backfills with exponential backoff (24h max). Accepted trade-off: brief window of unverified names on the board.

**7.4 Duplicate/out-of-order webhooks.** Three-layer handling (§4). Redelivered `checkout.session.completed` commits a no-op, acks 200.

**7.5 Checkout in flight at rollover.** Webhook validates season still ACTIVE; if ended → auto-refund + activity note (Q4).

**7.6 Neon outage/failover.** Money writes fail closed (correct — no unverified credit). Board serves last-known Redis projection with a "delayed" banner; SSE degrades to poll. Redis is never promoted to truth, so silent divergence is impossible.

---

## 8. Security boundaries

- **Rate limits (Upstash sliding window), enforced inside Server Actions** so middleware bypass is impossible: `startCheckout` 5/hr/IP + 5/hr/email-hash; YT-resolve 10/hr/IP; click endpoint 30/min/session; SSE connect cap/IP. 429 + `Retry-After`.
- **Webhook:** raw-body signature verify, 300s tolerance; Cloudflare allowlist optional; secret rotation runbook; respond 200 only post-commit so failures retry safely.
- **Amount integrity:** tier ids or custom amount only from client; server resolves dollars from `config/site.ts`; custom validated server-side to ≥ $5 and ≤ $10,000 per single bid (sanity cap). Event `amount_received` cross-checked.
- **Click anti-bot inflation:** (a) HMAC-signed outbound tokens `{creatorId, ts}` — forged/expired (>10 min) rejected; (b) `session_hash = HMAC(ip‖ua‖dailySalt)`, no raw IP persisted; (c) hard dedupe: one counted click per session per campaign per 24h, PG-enforced (Redis fast path only); (d) bot UAs dropped; (e) Cloudflare bot-fight + ASN rules; (f) weekly anomaly job flags outlier click-rate z-scores → human review, no auto-penalty in V1. Residual risk bounded: engagement ≤15% of score, so inflation can't buy a rank money wouldn't buy cheaper.
- **General:** zod at every boundary; secrets env-only (`env.ts` fails boot loudly); Sentry PII scrubbing; PostHog without emails/IPs; admin/refund ops are maintainer-flag CLI scripts, not UI, in V1; CSP headers everywhere.
- **Dependency posture (2026-08-24 audit):** no high/critical findings. Accepted: esbuild GHSA-67mh-4wv8-2f99, dev-only via drizzle-kit CLI, revisit when drizzle-kit drops the @esbuild-kit chain.

---

## 9. Transactional vs eventually consistent

**Single Postgres transaction (all-or-nothing):**

| Operation | Contents |
|---|---|
| Bid settlement | webhook_events insert → bid flip → total += → score/rank recompute → activity row (advisory lock held) |
| Refund application | bid → refunded, re-derived total/score/rank, activity row |
| Season rollover (per category) | snapshot season_results → end season → open next season |
| Campaign creation race | get-or-create under UNIQUE `(creator_id, season_id)` |
| Click counting (V1) | click insert + unique_clicks increment + rescore |

**Deliberately eventual (safe to lag/lose, self-healing):**

| Concern | Mechanism |
|---|---|
| Redis leaderboard projection | write-through post-commit + 5-min reconciler + PG fallback |
| SSE fan-out | best-effort; reconnect replay + fresh fetch |
| Visitor counts | heartbeat counters, cosmetic |
| YouTube enrichment | Inngest retries |
| Profile aggregate stats | derived at read from season_results — never stale, never maintained |
| Recap emails | queued fan-out (**deferred → B1**) |
| Telemetry | PostHog/Sentry async |
| Nightly bid-total reconciliation | detector only — alarms on drift, never silently adjusts money |

---

## Decisions Record (final answers, incl. overrides)

| # | Decision | Final |
|---|---|---|
| Q1 | Auth in V1 | None — anonymous bidding; Stripe Checkout email = contact |
| Q2 | Bid tiers | **$5 / $25 / $100 / $500 + custom, min $5, max $10,000/single bid** (override of proposed $10 floor — entry friction kept low for 2K–100K-sub micro-creators; ceiling added pre-Phase-1 as refund/dispute sanity cap) |
| Q3 | Scoring formula | Log-weighted `0.85·ln(1+$) + 0.15·ln(1+clicks)` |
| Q4 | Post-deadline payment | Auto-refund + activity note |
| Q5 | Recap emails | Deferred to V1.1, tracked as Backlog B1 (not silently dropped) |
| Q6 | Categories | **`categories` lookup table** (id, slug, name, active) seeded with Tech/Gaming/Education; adding a category = INSERT, never a migration (override of proposed fixed enum) |

## V1.1 Backlog (tracked, ordered)

1. **B1 — Post-season recap emails.** *Retention mechanic, not nice-to-have:* it is the reason a creator returns after week one. Requires email capture (Stripe email reuse or `creator_contacts` table + consent at checkout), Resend integration, Inngest fan-out per category top-N. Pulled forward before any other enhancement.
2. *Candidates, unprioritized:* verified-badge program (needs verifier policy — F6); lightweight login + "my campaigns" view (extends F7); multi-category creators; share-card image generation for rank moments.

Nothing from this backlog enters V1 without explicit approval.

## Changelog from approved draft (v0.1 → v1.0)

1. Categories: fixed enum → `categories` lookup table; FKs on `creators`/`seasons`; Redis keys and routing switched to slugs; "no hardcoded category lists" invariant added.
2. Bid tiers: $10/$50/$200/$1000/min-$10 → **$5/$25/$100/$500/min-$5**; CHECK constraint updated.
3. Recap emails moved from plain "deferred" to tracked V1.1 Backlog item B1 with retention rationale.
4. Status promoted DRAFT → APPROVED; open questions converted to Decisions Record.
5. Bid ceiling added pre-Phase-1: single bids capped at $10,000 (`CHECK (amount_cents BETWEEN 500 AND 1000000)` + server-side validation).
6. Stack amendment (2026-08-24, owner-directed, pre-Phase-3 approval): "Next.js 15" → **Next.js 16.3.2** (TypeScript 7 compatibility) and **webpack pipeline pinned instead of Turbopack** (NodeNext `.js` import resolution). Inngest (Phase 3.5) and SSE (Phase 4) verified compatible with the amended stack; see §1 bundler note.
7. Phase 3.5 delivered (2026-08-25): `leaderboardReconcile` implemented per §6 as an Inngest cron (`*/5 * * * *`, served at `/api/inngest`; production scheduling activates once INNGEST_SIGNING_KEY is configured) plus scheduler-independent on-demand trigger (`npm run dev:reconcile`); R3 tiebreak folded into ZSET scores via `toZsetScore` (§6 invalidation model). Test suites now refuse to run against non-local `DATABASE_URL`/`REDIS_URL` after a near-miss where plain `npm test` with production DSNs in `.env` attempted schema-wide TRUNCATE against prod.

## Approval log

| Section | Status | Date |
|---|---|---|
| 1. Directory/module architecture | APPROVED as proposed | 2026-08-24 |
| 2. Database schema | APPROVED — F1–F7 accepted; categories-table override applied | 2026-08-24 |
| 3. Ranking lifecycle | APPROVED (log-weighted 85/15 confirmed) | 2026-08-24 |
| 4. Payment lifecycle & idempotency | APPROVED as proposed | 2026-08-24 |
| 5. Season rollover | APPROVED (recap emails → Backlog B1) | 2026-08-24 |
| 6. Redis strategy | APPROVED as proposed | 2026-08-24 |
| 7. Failure scenarios | APPROVED as proposed | 2026-08-24 |
| 8. Security boundaries | APPROVED as proposed | 2026-08-24 |
| 9. Transactional vs eventual | APPROVED as proposed | 2026-08-24 |
| Stack amendment (§1): Next.js 16.3.2 + webpack pinned | Owner-requested update; Phase 3 approval pending | 2026-08-24 |
