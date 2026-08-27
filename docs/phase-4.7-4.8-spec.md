# Phase 4.7 + 4.8 — Specification (AWAITING OWNER APPROVAL)

Two small, independent phases resolving the outstanding items carried into
2026-08-27. Separate branches, separate PRs. **No code written until this
document is approved in writing.**

Context resolved before writing this spec:

- **Phase 4 PR question is settled.** `origin/main` contains all five PRs
  (#1 phase-3 `01828d9`, #2 phase-3.5 `3f00838`, #3 phase-4 `91b3904`,
  #4 phase-4.5 `c00482f`, #5 phase-4.6 `b8d5955`). Local `main` was simply
  14 commits behind `origin/main`; nothing was unmerged on the remote.
  `docs/progress.md` rows 4 / 4.5 / 4.6 are stale and are corrected as
  housekeeping below.
- **Tags: DONE 2026-08-27.** All five missing tags now created and pushed
  (`v0.3-phase3`@`01828d9`, `v0.3.5-phase3.5`@`3f00838`,
  `v0.4-phase4`@`91b3904`, `v0.4.5-phase4.5`@`c00482f`,
  `v0.4.6-phase4.6`@`b8d5955`), verified against the intended merge commits.
  Repo tag style is LIGHTWEIGHT — match it for future phases.

---

## Housekeeping

| # | Action | Status |
|---|---|---|
| H1 | `git merge --ff-only origin/main` to sync local main | **DONE** — `234d2ae` → `b8d5955` |
| H2 | Correct `docs/progress.md` rows 4 / 4.5 / 4.6 to ✅ with real merge commits | Pending — they still claim "unmerged" / "pending owner PR/merge/tag", which is factually wrong and misled this session's handoff |
| H3 | Create the five missing tags | **DONE** — owner ran and pushed; verified |

Also noted, **owner decision, not actioned:** `.env.local` contains a
`VERCEL_OIDC_TOKEN` dated 2026-08-25. OIDC tokens are ~12h-lived so it is long
expired and harmless, and it is covered by both `.gitignore` (`.env*.local`)
and `.vercelignore` (`.env.*`). Left in place.

---

# Phase 4.7 — Env-guard completion

Branch: `phase-4-7-env-guard-completion` (off `main` @ `b8d5955`)

## GOAL

Close the three remaining paths by which local tooling can reach production
Postgres/Redis, so the `assertLocalEnv()` interlock covers *every* local entry
point rather than most of them. Same failure class as the 2026-08-25
near-TRUNCATE, and one of the three sits inside a documented routine.

## The three gaps (verified 2026-08-27)

`.env` holds live production DSNs — confirmed by hostname only, no secret
values read:

```
DATABASE_URL host: ep-mute-dawn-axywisfs-pooler.c-4.us-east-2.aws.neon.tech
REDIS_URL   host: coherent-martin-153299.upstash.io
```

`.env.local` was checked and contains **only** `VERCEL_OIDC_TOKEN` — it does
**not** shadow the DSNs, so `next dev` genuinely resolves the production values.

| Gap | Path | Exposure |
|---|---|---|
| **G1** | `scripts/seed.ts` — `import 'dotenv/config'` at line 1, **no** `assertLocalEnv()` | INSERTs 3 categories + 3 active seasons. `npm run db:seed` is step 1 of the Phase-4.6 verification recipe (`docs/progress.md:54`), so it runs routinely. Would seed production Neon. |
| **G2** | `drizzle.config.ts` — `import 'dotenv/config'`, no guard → `db:push`, `db:migrate` | `db:push` diffs schema against the live DB and can DROP/ALTER columns. Highest severity of the three. |
| **G3** | `npm run dev` (`next dev --webpack`) | Boots the app against production Neon + Upstash. `/api/dev/fake-bid` is already double-guarded, but the SSE hub `INCR`s production visitor counters and `/api/inngest` can `ZADD`/`ZREM` production ZSETs. Already caused two misdiagnosed incidents on 2026-08-26 (slow `/[category]` 404s + empty `/categories`). |

## IN SCOPE

1. **`src/lib/env-guard.ts`** — extract the policy into a pure
   `assertLocalDsns(databaseUrl, redisUrl)`; reduce the existing
   `assertLocalEnv()` to a `process.env` wrapper over it. **Zero behavior
   change** for the 6 existing call sites and `tests/env-guard.test.ts`.
   The loopback allowlist stays defined exactly once.
2. **`scripts/env-preflight.ts`** (new) — resolves what the *consumer* will
   actually see, then calls `assertLocalDsns`. Two modes, because the two
   consumers resolve env differently and a guard that mis-resolves is worse
   than no guard:
   - `--mode=next` → replicates Next 16's documented cascade
     (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`,
     "Environment Variable Load Order"): `process.env` >
     `.env.$(NODE_ENV).local` > `.env.local` (skipped when `NODE_ENV=test`) >
     `.env.$(NODE_ENV)` > `.env`.
   - `--mode=dotenv` → replicates `dotenv/config` as used by
     `drizzle.config.ts`: `process.env` > `.env` only.
   Exits 1 with the existing `SAFETY ABORT` wording. Fails closed on
   unset/unparseable, same as today.
3. **`scripts/seed.ts`** — `assertLocalEnv()` as the first statement of
   `main()`, identical to the four `scripts/dev-*.ts` files.
4. **`package.json`** — gate `dev`, `db:push`, `db:migrate`, `db:seed` behind
   the matching preflight mode. `db:generate` is expected **not** to need a
   live connection (schema → SQL only); this will be verified, and it stays
   ungated only if confirmed.
5. **`tests/env-guard.test.ts`** — extend with cascade-resolution cases:
   which file wins per `NODE_ENV`; shell-exported `process.env` beats every
   file; `.env.local` correctly ignored under `NODE_ENV=test`; a local
   `.env.development.local` correctly *overriding* a prod `.env` (proves no
   false aborts); unparseable/unset still fail closed.
6. **Docs** — architecture.md changelog entry #11; progress.md row + note.

## OUT OF SCOPE (explicit non-goals)

- **`next build` / `next start` / production runtime are NOT gated.** Vercel
  never reads `.env` (it is `.vercelignore`d; prod env comes from the Vercel
  env store), so gating `npm run dev` alone costs nothing on deploys. Gating
  the build would break them. Hard requirement, verified in the DoD.
- Rotating, editing, or relocating any credential in `.env` — owner-only.
- Deleting `.env.local` or its stale OIDC token — owner call.
- `src/lib/env.ts`, the zod env validator described in architecture §1 that
  was **never built**. Pre-existing deviation, logged only, not fixed here.
- Any SSE, settlement, schema, scoring, or UI change.
- Anything touching Stripe.

## DEFINITION OF DONE

Every item demonstrated with pasted real terminal output.

1. **Blocked with prod env present.** With `.env` untouched and no shell
   overrides, each of `npm run db:seed`, `npm run db:push`,
   `npm run db:migrate`, `npm run dev` exits **1** with `SAFETY ABORT` naming
   the offending host. Timing shown to evidence the abort precedes any
   connection attempt (immediate, not a DNS/TCP timeout).
2. **No production connection is ever opened during verification.** DoD #1 is
   additionally reproduced against a sentinel non-local host
   (`postgres://u@db.invalid/db`) so "does it really abort" is answered
   without pointing tooling at real production even once.
3. **Unblocked with local env.** With local DSNs shell-exported, all four
   commands proceed: `db:seed` prints the expected `3 / 3 / 0` counts,
   `npm run dev` boots and `/tech` renders a live board.
4. **No false aborts.** A temporary `.env.development.local` holding local
   DSNs allows `npm run dev` even while `.env` holds prod — proving the
   cascade is honored rather than approximated. File removed after.
5. **Suite green.** Full run passes at ≥ current 68/68, plus the new cascade
   cases, with local DSNs exported.
6. **Deploy path unaffected.** `npm run build` succeeds with prod-shaped
   non-local DSNs in env, proving the guard did not leak into the build.

---

# Phase 4.8 — applyDelta rank resort

Branch: `fix/applydelta-rank-resort` (off `main` @ `b8d5955`)

## GOAL

Fix the pre-existing Phase-4 client bug where a displaced incumbent keeps a
stale rank after a single-entry `rank_delta`, so the visible #1 can disagree
with server truth until a reconnect heals it.

## The bug (confirmed in code, not just from notes)

`src/features/leaderboard/events.ts:51` publishes `entries: [entry]` —
**always exactly one entry**, the bidder only. The displaced incumbent is
never told its rank moved. `applyDelta` then sorts
(`LeaderboardScreen.tsx:59`):

```ts
.sort((a, b) => a.rank - b.rank || a.handle.localeCompare(b.handle))
```

Two rows now both hold `rank: 1`, so ordering falls through to **alphabetical
handle order**. If `@zeta` overtakes `@alpha`, the client keeps `@alpha`
visually at #1 and renders "1" twice. Reproduces only when the bidder's handle
sorts *after* the incumbent's. Postgres and the ZSET are correct throughout;
only this client view is wrong, and it self-heals on the reconnect refetch.

## IN SCOPE

1. **Extract `applyDelta`** from `LeaderboardScreen.tsx` into a pure
   `src/features/leaderboard/apply-delta.ts` — no React, no framer-motion,
   no `next/link` imports. Required for testability: the vitest suite is
   node-env with no jsdom, so the function cannot be reached where it
   currently sits. Mirrors the Phase-4.6 `Avatar` extraction precedent.
   `LeaderboardScreen.tsx` imports it; **no behavior change** beyond the fix.
2. **The fix:** after merging entries, sort by `score` **descending**, then
   reassign `rank = index + 1`. Events carry absolute scores, so single-entry
   deltas become self-consistent.
3. **Tie handling.** The SSE `score` is the *display* score
   (`numeric(14,4)`), **not** the tiebreak-folded ZSET score, so on a
   byte-equal tie the client cannot reproduce the server's `firstBidOrdinal`
   ordering. Deterministic client-side fallback: `score` desc → prior `rank`
   asc → `handle`. A true tie resolves stably and heals on the next
   refetch/reconcile. This limitation gets an in-code comment.
4. **`dayDelta` correctness.** Currently computed from the event's `newRank`
   *inside* the merge loop. After the fix, ranks are assigned *after*
   sorting, so `dayDelta` must be recomputed against the final rank to keep
   the documented `dayStart = rank + dayDelta` invariant. This is the one
   genuine trap in the change.
5. **Unit tests** in the existing suite: the exact `@zeta`-overtakes-`@alpha`
   failure (red on current code, green after); a byte-equal-score tie;
   `dayDelta` preserved across a move; a creator new to this client; a
   multi-entry payload staying correct (forward-compat).

## OUT OF SCOPE (explicit non-goals)

- `lib/sse.ts` and `features/leaderboard/events.ts` payload shape — **no**
  `firstBidOrdinal` field, no multi-entry publishing. That was the rejected
  alternative; revisit only if ties prove to matter in practice.
- Server settlement, schema, scoring, reconciler.
- Styling, podium treatment, or any other component.

## DEFINITION OF DONE

1. **Red-then-green.** The new test fails against current `applyDelta` and
   passes after — both runs pasted, so the test is proven to cover the bug
   rather than merely passing.
2. **Live two-tab check.** `scripts/sse-ui-check.mjs` passes, plus a manual
   overtake deliberately chosen so the **bidder's handle sorts after the
   incumbent's** (the case that reproduces the bug): displaced incumbent
   visibly drops to #2, no duplicate rank numerals. Screenshot evidence.
3. **Animation intact.** Framer Motion FLIP still animates the moved rows —
   no jump, no remount. Confirmed visually, since the extraction touches the
   component's imports.
4. **Suite green** at ≥ 68/68 plus the new cases.
5. **Reduced-motion path** still honored.

---

## Merge order

4.7 and 4.8 are independent — they share no files. Either order; 4.7 first is
suggested since it makes every subsequent local verification run safe by
default.

Phase 4.3 (creator claim/submission form) starts only after these two land and
the owner supplies the scoped prompt.

Stripe end-to-end verification remains blocked on India access and is not
touched by either phase.
