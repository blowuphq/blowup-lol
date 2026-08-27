# Blowup.io — Phase Progress Tracker

Running log of build phases. One line per phase, updated after each merge.
Status: ✅ done · 🔄 in progress · ⏳ planned

| Phase | Status | Commit | Tag | Summary |
|---|---|---|---|---|
| 1 — Database foundation | ✅ | `7b0a4f1` | `v0.1-phase1` | DB schema, migrations, seed (Tech/Gaming/Education), append-only trigger; schema tests 20/20 |
| 2 — Ranking pipeline | ✅ | `3d51128` | `v0.2-phase2` | Fake-bid ranking pipeline: Bid → SUM-derived totals → 85/15 score → rank recompute → activity rows → Redis projection; verifier proves PG↔Redis agreement; tests 29/29; report in `docs/phase2-report.md`, race risks in `docs/phase2-race-risks.md` |
| 3 — Stripe payments | ✅ | `01828d9` (PR #1 merge) | `v0.3-phase3` | Checkout + verified webhook settlement replacing fake-bid payment ids; merged to main 2026-08-25 |
| 3.5 — Projection reconciler | ✅ | `3f00838` (PR #2 merge) | `v0.3.5-phase3.5` | `leaderboardReconcile`: Inngest cron every 5 min (`/api/inngest`) + on-demand `npm run dev:reconcile`; full ZSET↔PG diff, targeted ZADD/ZREM repair verified in-run. R3: tiebreak folded into ZSET scores (`score − 1e-11·firstBidOrdinal`). R1/R2/R3 dispositions resolved in `docs/phase2-race-risks.md`; tests 57/57 incl. new `tests/zset-tiebreak.test.ts`, `tests/reconcile.test.ts`; test suites now refuse non-local DATABASE_URL/REDIS_URL |
| 4 — Realtime (SSE) | ✅ | `91b3904` (PR #3 merge) | `v0.4-phase4` | Public live boards: `/[category]` + `/categories` index. SSE hub over Redis Streams (`lib/sse.ts`) with Last-Event-ID replay, per-connection blocking readers, concrete cursors; `rank_delta` published post-commit by BOTH settlement paths; visitor counter (§6); PG circuit-break banner (§7.6); formula panel runs the scorer's own modules live (transparency invariant); Framer Motion rank animation; tests 68/68 incl. `tests/live-board.test.ts`; DoD demonstrated live: two-tab fan-out <600 ms, reconnect catch-up via Last-Event-ID, 24-bid burst @26 bids/s zero drops/desync, counter incr/decr/clamp, Redis↔PG parity MATCH incl. two real $-ties broken by firstBid order |
| 4.5 — Board UX refinements | ✅ | `c00482f` (PR #4 merge) | `v0.4.5-phase4.5` | Components-and-styling only (no SSE/settlement/schema/scoring changes): inline "Boost" CTA on every row opening the existing `/api/checkout` flow with tier picker from `BID_TIERS_CENTS`; podium treatment for ranks 1–3 (same layout parent, animations preserved); proof-of-life line (viewers + season total + round end); plain-English FAQ beside the formula panel; category chips with season totals on board + index. Screenshot-verified vs Phase-4 baseline; suite 68/68 ✓; two-tab SSE re-check delivers deltas + converging totals on both tabs |
| 4.6 — Root landing showcase | ✅ | `b8d5955` (PR #5 merge) | `v0.4.6-phase4.6` | Root `/` evolved from "coming soon" to live showcase: hero wordmark kept verbatim; server-rendered proof-of-life stats bar (season totals from the same `loadBoard()` sums the index uses; "watching live" from §6 Redis visitor counters across active slugs — snapshot, §9 cosmetic semantics); reigning-#1 preview cards from the same `rows[0]` derivation as `/categories` (parity by construction, verified byte-identical); 3-step how-it-works; "Enter the arena" CTA into `/categories`. Only client JS: dependency-free `CountUp` (~40 lines, SSR emits final values, reduced-motion honored). `Avatar` extracted from LeaderboardRow into its own server-safe module after the prod build showed the import dragging framer-motion (~40 KB gzip) onto `/` — re-exported for compat, board pages unchanged. Prod warm 30–55 ms loopback; mobile 390 px clean; suite 68/68 ×2. |

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
- Phase 4.5 regression finding (2026-08-26): the two-tab SSE re-check caught
  a PRE-EXISTING Phase-4 client gap, not a 4.5 regression (`applyDelta` in
  `LeaderboardScreen.tsx` is untouched by the 4.5 diff). A single-entry
  `rank_delta` carries only the bidder's new rank, so a displaced incumbent
  keeps its stale `rank` and the client sort ties over to handle-order —
  the old leader stays visually on top until a reconnect's fresh-fetch
  resync heals the board. Server truth (PG + ZSET) is correct at all times;
  totals converge on every tab. Proposed fix, PENDING OWNER APPROVAL:
  after merging entries, sort by score desc and reassign `rank = index+1`
  (events carry absolute scores, so single-entry deltas become
  self-consistent). Owner may prefer it on the unmerged Phase-4 branch.
- Same window, operational: the dev ZSET was found drifted (@dod-gamma
  5.1947 in ZSET vs 5.5696 in PG — the 8/25 +$250 settlement's ZADD failed
  open, most likely during the Redis container restart; local Inngest cron
  was not running to auto-heal). `npm run dev:reconcile` repaired exactly
  the one drifted entry (`repairs=1/1, healthyAfter=true`) — Phase-3.5
  tooling doing its job on a real drift.
- Phase 4.6 verification recipe (2026-08-26): the demo board is rebuilt
  after every suite run with `npm run db:seed` + nine `dev:fake-bid` calls
  (tech only: gamma 120000¢, alpha 105000¢, beta 50000, delta 40000,
  epsilon 32000, zeta 24000, eta 17000, theta 10000, iota 6500 → 9
  creators, $4,045 total; fake bids carry zero clicks so rank order is
  money-sorted and any split hitting these sums renders identically).
  Landing-page stats were verified live: settled bid moved the root stats
  bar $4,020 → $4,045; an SSE connection moved "watching live" 0 → 1 → 0.
  Windows gotcha learned en route: stopping the `npm run dev` shell task
  kills only the npm wrapper — the next-server child survives holding
  :3000; kill the listening PID (netstat) before restarting, or the new
  server 3001-falls-back / the zombie serves stale `.next` state (500s
  after a prod build clobbers its cache).

## Process from Phase 3 onward

- One branch per phase (`phase-3-stripe-payments`, …) branched from `main`.
- PR opened when the phase passes its Definition of Done; merge is done
  manually on GitHub by the owner — never automated.
- Tag on merge (`v0.3-phase3`, …) and update this file afterward.
