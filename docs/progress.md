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
| 4.7 — Env-guard completion | ✅ | `0cf4cdc` (PR #7 merge) | `v0.4.7-phase4.7` | Closes the last three paths by which local tooling could reach production Postgres/Redis: `scripts/seed.ts` (no guard at all), `drizzle.config.ts` → `db:push`/`db:migrate`, and `npm run dev`. `assertLocalDsns(dbUrl, redisUrl)` extracted as the pure form of the check with `assertLocalEnv()` reduced to a `process.env` wrapper (allowlist + message text unchanged ⇒ six existing call sites behavior-identical); new `scripts/env-preflight.ts` over pure `scripts/env-cascade.ts` gates `dev` (`--mode=next`) and `db:push`/`db:migrate`/`db:seed` (`--mode=dotenv`), replicating each consumer's real env cascade rather than approximating one; `next build`/`next start` deliberately ungated (Vercel never reads `.env`). All four commands exit 1 in 1–2 ms against prod `.env` and against a `db.invalid` sentinel; all four proceed with local DSNs (`db:seed` → 3/3/0, `/tech` renders 9 rows); a temp `.env.development.local` unblocks `dev` while `.env` holds prod; `npm run build` exits 0 with prod-shaped DSNs; suite 78/78 (+10 cascade cases). |
| 4.8 — applyDelta rank resort | 🔄 | branch `fix/applydelta-rank-resort` (off `main` @ `0cf4cdc`) | — | Closes the Phase-4.5 client-merge gap noted below: a single-entry `rank_delta` left displaced rows holding a stale `rank`, so the overtaken #1 and the new #1 both rendered "1" (no "2") and handle order kept the ex-leader on top until a reconnect healed the board. `applyDelta` extracted verbatim from `LeaderboardScreen.tsx` into `src/features/leaderboard/apply-delta.ts` (`3bfa6c6` — vitest is node-environment with no jsdom, so the reducer was untestable inside a `'use client'` component), then fixed (`0440712`): sort by score desc, reassign `rank = index+1`, and recompute `dayDelta` against the FINAL rank so `dayStart = rank + dayDelta` survives the resort (`null` stays `null`). Received `newRank` demoted to a tiebreak for exactly-equal scores. 10 new cases in `tests/apply-delta.test.ts` — 6 fail against `3bfa6c6`, 10 pass against `0440712`; suite 88/88 (78 baseline + 10 new). Two new live checks (`scripts/rank-resort-check.mjs`, `scripts/flip-motion-check.mjs`) because `sse-ui-check.mjs` passes red — it only asserts both tabs AGREE on #1, and they agreed on the same wrong leader. Live red→green: `1:@alpha 1:@zeta …` → `1:@zeta 2:@alpha …`, numerals 1..9, 8/8 pass, incumbent badge `▲ up 1 today` → `— holding`; 17 intermediate FLIP positions per moving row, 9/9 rows not remounted. No scoring/settlement/schema/SSE-protocol change. PR pending owner review |

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
- **Since Phase 4.7 (2026-08-27) that list is no longer partial.** `npm run
  dev`, `db:seed`, `db:push` and `db:migrate` are gated too, each behind
  `scripts/env-preflight.ts` in the mode matching how that command actually
  resolves env (`--mode=next` replicates Next's
  `process.env > .env.$(NODE_ENV).local > .env.local > .env.$(NODE_ENV) > .env`
  ladder; `--mode=dotenv` replicates `dotenv/config`, which reads only `.env`).
  Same shell-export escape hatch as above, and a local
  `.env.development.local` also works for `npm run dev` specifically. NOT
  gated, by design: `npm run build` / `npm start` (Vercel never reads `.env`)
  and `db:generate` (verified to need no live connection).
- Phase 1's original commit was amended to fold in `docs/phase1-deviations.md`,
  so its pre-amend hash (1466402) no longer exists; `7b0a4f1` is the real,
  reviewed checkpoint.
- Phase 2 scope guardrails held: no Stripe, no UI, no YouTube API, no SSE.
- Phase 4 branch topology: `phase-4-live-leaderboard` was stacked on the
  phase-3.5 line (it consumes the R3 tiebreak fold and the env-guard from
  there), not on `main`. **Resolved 2026-08-27 — both are merged** (PR #2
  `3f00838`, PR #3 `91b3904`); the merge-order caveat no longer applies.
- Phase 4 scope guardrails held: no activity feed UI, no share cards,
  no click tracking, no creator submission form.
- Phase 4.5 regression finding (2026-08-26): the two-tab SSE re-check caught
  a PRE-EXISTING Phase-4 client gap, not a 4.5 regression (`applyDelta` in
  `LeaderboardScreen.tsx` is untouched by the 4.5 diff). A single-entry
  `rank_delta` carries only the bidder's new rank, so a displaced incumbent
  keeps its stale `rank` and the client sort ties over to handle-order —
  the old leader stays visually on top until a reconnect's fresh-fetch
  resync heals the board. Server truth (PG + ZSET) is correct at all times;
  totals converge on every tab. **Fixed in Phase 4.8 (2026-08-28)** exactly as
  proposed: after merging the event's entries `applyDelta` sorts by score
  descending and reassigns `rank = index+1` (events carry absolute scores, so a
  single-entry delta becomes self-consistent), recomputing each row's `dayDelta`
  against its FINAL rank so the "up/down N today" badge cannot go stale. Landed
  on `fix/applydelta-rank-resort` off `main`, not on the Phase-4 branch, which
  is now merged.
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
- Phase 4.7 findings worth keeping (2026-08-27): (a) `next dev` and
  `dotenv/config` resolve `DATABASE_URL` from **different files**, so one
  generic "read .env and check it" guard would have been wrong for one of the
  two consumers — hence the two explicit preflight modes. (b) The local
  services are containers `blowup-pg` (postgres:16-alpine) and `blowup-redis`
  (redis:7-alpine) with a restart policy, so they come up on their own once
  Docker Desktop is started; there is no compose file in the repo. (c) `next
  build` does touch Redis at build time (ioredis DNS errors surface, non-fatal
  with an unreachable host) — another reason the build path must not be gated
  by a local-only allowlist.
- Phase 4.8 verification tooling (2026-08-28): `scripts/rank-resort-check.mjs`
  and `scripts/flip-motion-check.mjs` were added because
  `scripts/sse-ui-check.mjs` **passes against the bug** — it asserts only that
  both tabs agree on #1, and under the old reducer both agreed on the same
  wrong leader. Two lessons worth keeping: (1) a screenshot of a BACKGROUNDED
  tab hangs forever — Chrome stops producing frames and CDP's
  `captureScreenshot` waits for one, so any multi-tab script must
  `bringToFront()` first; the `--disable-*-backgrounding` flags keep timers
  alive, not the compositor. (2) `process.exit()` inside a `try` skips the
  `finally`, orphaning a headless Chrome per run — use `process.exitCode`.
- Same window, a reduced-motion finding, NOT fixed (out of 4.8's scope): the
  `@media (prefers-reduced-motion: reduce)` block in `globals.css` shortens the
  flash overlay only. Nothing in `src/` sets `MotionConfig reducedMotion` or
  `useReducedMotion`, so Framer Motion's layout slide still runs under `reduce`
  — measured live, the demoted row still travelled through intermediate
  positions. The comment above that block ("rows still reorder instantly, just
  without the slide/flash") overstates it. Pre-existing since Phase 4.
- Demo-board caveat for anyone re-running these checks: the integration suite
  TRUNCATEs the local database, so rebuild the board (Phase-4.6 recipe above)
  after any `npm test`. The rank-resort check also needs a bidder whose handle
  sorts AFTER the current #1's — it refuses to run otherwise, since a pass on a
  bidder that sorts earlier would prove nothing.

## Process from Phase 3 onward

- One branch per phase (`phase-3-stripe-payments`, …) branched from `main`.
- PR opened when the phase passes its Definition of Done; merge is done
  manually on GitHub by the owner — never automated.
- Tag on merge (`v0.3-phase3`, …) and update this file afterward.
