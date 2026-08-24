# Blowup.io — Phase Progress Tracker

Running log of build phases. One line per phase, updated after each merge.
Status: ✅ done · 🔄 in progress · ⏳ planned

| Phase | Status | Commit | Tag | Summary |
|---|---|---|---|---|
| 1 — Database foundation | ✅ | `7b0a4f1` | `v0.1-phase1` | DB schema, migrations, seed (Tech/Gaming/Education), append-only trigger; schema tests 20/20 |
| 2 — Ranking pipeline | ✅ | `3d51128` | `v0.2-phase2` | Fake-bid ranking pipeline: Bid → SUM-derived totals → 85/15 score → rank recompute → activity rows → Redis projection; verifier proves PG↔Redis agreement; tests 29/29; report in `docs/phase2-report.md`, race risks in `docs/phase2-race-risks.md` |
| 3 — Stripe payments | 🔄 | — | — | Checkout + verified webhook settlement replacing fake-bid payment ids |
| 3.5 — Projection reconciler | ⏳ | — | — | Inngest `verifyLeaderboard` (scheduled + on-demand); fold score tiebreak into ZSET score — R2/R3 dispositions in `docs/phase2-race-risks.md` |
| 4 — Realtime (SSE) | ⏳ | — | — | Live rank updates; **gated on 3.5** (no SSE before the reconciler exists) |

## Notes

- Phase 1's original commit was amended to fold in `docs/phase1-deviations.md`,
  so its pre-amend hash (1466402) no longer exists; `7b0a4f1` is the real,
  reviewed checkpoint.
- Phase 2 scope guardrails held: no Stripe, no UI, no YouTube API, no SSE.

## Process from Phase 3 onward

- One branch per phase (`phase-3-stripe-payments`, …) branched from `main`.
- PR opened when the phase passes its Definition of Done; merge is done
  manually on GitHub by the owner — never automated.
- Tag on merge (`v0.3-phase3`, …) and update this file afterward.
