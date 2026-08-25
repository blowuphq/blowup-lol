# Blowup.io — Phase Progress Tracker

Running log of build phases. One line per phase, updated after each merge.
Status: ✅ done · 🔄 in progress · ⏳ planned

| Phase | Status | Commit | Tag | Summary |
|---|---|---|---|---|
| 1 — Database foundation | ✅ | `7b0a4f1` | `v0.1-phase1` | DB schema, migrations, seed (Tech/Gaming/Education), append-only trigger; schema tests 20/20 |
| 2 — Ranking pipeline | ✅ | `3d51128` | `v0.2-phase2` | Fake-bid ranking pipeline: Bid → SUM-derived totals → 85/15 score → rank recompute → activity rows → Redis projection; verifier proves PG↔Redis agreement; tests 29/29; report in `docs/phase2-report.md`, race risks in `docs/phase2-race-risks.md` |
| 3 — Stripe payments | ✅ | `01828d9` (PR #1 merge) | pending owner tag `v0.3-phase3` | Checkout + verified webhook settlement replacing fake-bid payment ids; merged to main 2026-08-25 |
| 3.5 — Projection reconciler | ✅ | `a6008b6` (branch `phase-3-5-projection-reconciler`) | pending owner tag `v0.3.5-phase3.5` | `leaderboardReconcile`: Inngest cron every 5 min (`/api/inngest`) + on-demand `npm run dev:reconcile`; full ZSET↔PG diff, targeted ZADD/ZREM repair verified in-run. R3: tiebreak folded into ZSET scores (`score − 1e-11·firstBidOrdinal`). R1/R2/R3 dispositions resolved in `docs/phase2-race-risks.md`; tests 57/57 incl. new `tests/zset-tiebreak.test.ts`, `tests/reconcile.test.ts`; test suites now refuse non-local DATABASE_URL/REDIS_URL |
| 4 — Realtime (SSE) | ⏳ | — | — | Live rank updates; **gate satisfied** (reconciler shipped in 3.5) — awaiting owner approval |

## Notes

- **Running tests since Phase 3.5 (2026-08-25):** `.env` holds PRODUCTION DSNs,
  and every integration suite truncates the database it points at. A vitest
  guard (`tests/global-setup.ts`) now aborts unless both URLs are local; run
  the suite with shell-exported local DSNs, e.g.
  `$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/blowup'; $env:REDIS_URL='redis://localhost:6379'; npm test`.
  The same caution applies to `scripts/dev-*` CLIs — they read `.env` directly.
- Phase 1's original commit was amended to fold in `docs/phase1-deviations.md`,
  so its pre-amend hash (1466402) no longer exists; `7b0a4f1` is the real,
  reviewed checkpoint.
- Phase 2 scope guardrails held: no Stripe, no UI, no YouTube API, no SSE.

## Process from Phase 3 onward

- One branch per phase (`phase-3-stripe-payments`, …) branched from `main`.
- PR opened when the phase passes its Definition of Done; merge is done
  manually on GitHub by the owner — never automated.
- Tag on merge (`v0.3-phase3`, …) and update this file afterward.
