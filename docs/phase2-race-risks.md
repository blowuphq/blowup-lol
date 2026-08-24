# Phase 2 — Race-Condition Risk Analysis

Status: DELIVERED 2026-08-24 (DoD item #4). Scope: risks identified from code review
plus the concurrency tests actually run — no real concurrent load was exercised
(single dev instance, `Promise.all` races only).

## What is already proven safe (by tests, not assumption)

1. **Write serialization.** Every bid settles inside one transaction holding
   `pg_advisory_xact_lock(hashtext(season_id))`. Concurrent `recordFakeBid` calls
   (`Promise.all`) produce: distinct ranks, no duplicate ranks in `campaigns`,
   a coherent Redis projection, and activity rows whose reported ranks stay within
   `{1..N}`. This lock works across app instances too — it lives in Postgres, not
   process memory — so multi-server V1 writes are serialized by the same mechanism.

2. **Atomicity.** Bid insert, SUM-derived total, score, campaign update, whole-season
   rank recompute, and activity insert commit together or not at all. There is no
   intermediate state visible to any reader. Totals are never incremented blindly —
   they are re-derived from `SUM(bids)` each time (append-only invariant).

3. **Ordering invariant.** Postgres commits first; Redis ZADD happens strictly after;
   SSE (future) after that. A crash can only ever leave Redis *stale*, never *ahead*
   of truth.

## Remaining risks (accepted for V1, with planned mitigations)

### R1 — Crash window between PG commit and ZADD  ⚠ highest-priority residual
If the process dies (deploy, OOM) in the milliseconds between transaction commit and
`safeZadd`, the Redis projection stays stale until the next successful bid touches
that creator/season. Nothing auto-repairs it today.
**Planned:** background reconciler (Inngest per architecture §7) running
`verifyLeaderboard` on a cadence and repairing drift; until then `npm run
dev:leaderboard -- <slug>` detects it manually (exit 1 on mismatch).

> **Disposition (2026-08-24, owner decision):** promoted from "planned mitigation"
> to its own **Phase 3.5** — Inngest `verifyLeaderboard` reconciler, scheduled +
> on-demand — sequenced AFTER Phase 3 (Stripe/webhooks) and BEFORE Phase 4 (SSE),
> enforcing this section's gate.

### R2 — `safeZadd` fails open by design
Redis write failures retry twice, then log and swallow — deliberately, because Redis
must never block or roll back Postgres truth. Consequence: silent drift is possible
until R1's reconciler exists. Acceptable while truth remains authoritative in PG;
becomes unacceptable the moment SSE reads Redis live without a reconciliation loop.
**Gate:** do not ship Phase 4 (SSE) before the reconciler.

### R3 — Exact-score ties order differently in Redis vs Postgres
PG tie-breaks equal scores by first succeeded bid time, then campaign id. Redis ZSETs
tie-break identical float scores lexicographically by member (creator UUID). Two
creators with byte-equal rounded scores (e.g., both $25 total, zero clicks) can
therefore display in different relative order depending on which store served the
read. Low probability, self-heals as soon as scores diverge, but real.
**Proposed fix (Phase 3):** fold the tiebreak into the ZSET score itself
(`score - epsilon*firstBidOrdinal`) or serve display order from PG with Redis only
as the hot cache of scores.

> **Disposition (2026-08-24, owner decision):** adopt the fold-the-tiebreak-into-
> the-score fix so Redis ordering is self-sufficient without a PG fallback.
> Scheduled for **Phase 3.5** alongside the reconciler — explicitly OUT of Phase 3 scope.

### R4 — Season-wide advisory lock is a throughput ceiling
The lock serializes all writes per season. Correct, but caps a season at one bid
settlement at a time. Irrelevant at launch scale (bids are deliberate, expensive
events); revisit only if bid volume grows ~100×. `hashtext` collisions across
different seasons would merely add waiting, never corruption.

### R5 — Float64 projection vs numeric(14,4) truth
Scores are computed to 4dp and stored exact in PG; Redis stores IEEE doubles. At V1
magnitudes (score < ~10) double precision error is ~1e-16, far below the 1e-9
tolerance used by `verifyLeaderboard`. Not a practical risk; documented so nobody
"fixes" it by storing strings in the ZSET.

## Non-risks worth stating once

- **Pointer repair races:** two readers can repair the season pointer concurrently —
  both write the same idempotent value.
- **Lazy campaign creation:** get-or-create relies on the unique constraint; losers
  of the race re-select within the same locked transaction.
- **Season rollover** (weekly reset) does not exist yet; the pipeline assumes exactly
  one active season per category, which the partial unique index guarantees.
