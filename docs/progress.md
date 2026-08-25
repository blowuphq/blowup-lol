# Blowup.io — Phase Progress Tracker

Running log of build phases. One line per phase, updated after each merge.
Status: ✅ done · 🔄 in progress · ⏳ planned

| Phase | Status | Commit | Tag | Summary |
|---|---|---|---|---|
| 1 — Database foundation | ✅ | `7b0a4f1` | `v0.1-phase1` | DB schema, migrations, seed (Tech/Gaming/Education), append-only trigger; schema tests 20/20 |
| 2 — Ranking pipeline | ✅ | `3d51128` | `v0.2-phase2` | Fake-bid ranking pipeline: Bid → SUM-derived totals → 85/15 score → rank recompute → activity rows → Redis projection; verifier proves PG↔Redis agreement; tests 29/29; report in `docs/phase2-report.md`, race risks in `docs/phase2-race-risks.md` |
| 3 — Stripe payments | ✅ | `01828d9` (PR #1 merge) | pending owner tag `v0.3-phase3` | Checkout + verified webhook settlement replacing fake-bid payment ids; merged to main 2026-08-25 |
| 3.5 — Projection reconciler | ✅ | `a6008b6` (branch `phase-3-5-projection-reconciler`) | pending owner tag `v0.3.5-phase3.5` | `leaderboardReconcile`: Inngest cron every 5 min (`/api/inngest`) + on-demand `npm run dev:reconcile`; full ZSET↔PG diff, targeted ZADD/ZREM repair verified in-run. R3: tiebreak folded into ZSET scores (`score − 1e-11·firstBidOrdinal`). R1/R2/R3 dispositions resolved in `docs/phase2-race-risks.md`; tests 57/57 incl. new `tests/zset-tiebreak.test.ts`, `tests/reconcile.test.ts`; test suites now refuse non-local DATABASE_URL/REDIS_URL |
| 4 — Realtime (SSE) | ✅ | branch `phase-4-live-leaderboard` (unmerged; stacked on the 3.5 line — merge 3.5 first) | pending owner PR/merge/tag | Public live boards: `/[category]` + `/categories` index. SSE hub over Redis Streams (`lib/sse.ts`) with Last-Event-ID replay, per-connection blocking readers, concrete cursors; `rank_delta` published post-commit by BOTH settlement paths; visitor counter (§6); PG circuit-break banner (§7.6); formula panel runs the scorer's own modules live (transparency invariant); Framer Motion rank animation; tests 68/68 incl. `tests/live-board.test.ts`; DoD demonstrated live: two-tab fan-out <600 ms, reconnect catch-up via Last-Event-ID, 24-bid burst @26 bids/s zero drops/desync, counter incr/decr/clamp, Redis↔PG parity MATCH incl. two real $-ties broken by firstBid order |

## Notes

- **Running tests & dev-* CLIs since Phase 3.5 (2026-08-25):** `.env` holds
  PRODUCTION DSNs, integration suites truncate the database they point at,
  and the dev-* CLIs write real bids/repairs. A shared guard
  (`src/lib/env-guard.ts`) aborts ALL of these unless both URLs are local —
  wired into `tests/global-setup.ts` and as the first statement of every
  `scripts/dev-*` CLI. Run any of them with shell-exported local DSNs, e.g.
  `$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/blowup'; $env:REDIS_URL='redis://localhost:6379'; npm test`
  (or `npm run dev:fake-bid -- …`). Guard behavior is unit-pinned in
  `tests/env-guard.test.ts`.
- Phase 1's original commit was amended to fold in `docs/phase1-deviations.md`,
  so its pre-amend hash (1466402) no longer exists; `7b0a4f1` is the real,
  reviewed checkpoint.
- Phase 2 scope guardrails held: no Stripe, no UI, no YouTube API, no SSE.
- Phase 4 branch topology: `phase-4-live-leaderboard` is stacked on the
  phase-3.5 line (it consumes the R3 tiebreak fold and the env-guard from
  there), not on `main` — 3.5 still awaits owner merge. Merge order when
  reviewing: `phase-3-5-projection-reconciler` first, then the Phase-4 PR.
- Phase 4 scope guardrails held: no activity feed UI, no share cards,
  no click tracking, no creator submission form.

## Process from Phase 3 onward

- One branch per phase (`phase-3-stripe-payments`, …) branched from `main`.
- PR opened when the phase passes its Definition of Done; merge is done
  manually on GitHub by the owner — never automated.
- Tag on merge (`v0.3-phase3`, …) and update this file afterward.
