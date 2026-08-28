# Phase 4.7 — Env-guard completion: delivery report

Branch: `phase-4-7-env-guard-completion` (off `main` @ `878a556`)
Commits: `d5cb68d` (code) · `e0c319b` (docs) · `a3a3c1f` (spec, cherry-picked)
Date: 2026-08-27 · Status: **DoD met, awaiting owner review**

---

## Note before the DoD: the spec's stated base was one commit stale

The spec says "off `main` @ `b8d5955`". `main` is now at `878a556` — you
committed `docs/progress.md` corrections yourself at 14:00, which **completes
housekeeping item H2**. All three rows (4, 4.5, 4.6) are now ✅ with real merge
commits and real tags. Nothing was left for me to do there. This branch is off
`878a556`, so it includes your fix.

`docs/phase-4.7-4.8-spec.md` lived only on `docs/phase-4-7-4-8-spec` and was not
on disk on this branch, so I cherry-picked it here (`a3a3c1f`) — the governing
document now travels with the work.

---

## What changed

| File | Change |
|---|---|
| `src/lib/env-guard.ts` | Extracted pure `assertLocalDsns(databaseUrl, redisUrl)`; `assertLocalEnv()` is now a `process.env` wrapper over it. Allowlist and `SAFETY ABORT` message text **unchanged**. Also exports `hostnameOf` (display) and `LOCAL_HOSTNAMES`. |
| `scripts/env-cascade.ts` | **NEW.** Pure, side-effect-free resolver: given a mode, `NODE_ENV` and a directory, returns the value a consumer will actually see **and where it came from**. Never mutates `process.env`, never connects. |
| `scripts/env-preflight.ts` | **NEW.** The CLI gate. `--mode=next` / `--mode=dotenv`, exits 1 with the existing wording, prints hostnames only. |
| `scripts/seed.ts` | `assertLocalEnv()` as the first statement of `main()` (gap G1). |
| `package.json` | `dev` gated with `--mode=next`; `db:push` / `db:migrate` / `db:seed` with `--mode=dotenv`. `build`, `start`, `db:generate` untouched. |
| `tests/env-guard.test.ts` | +10 cases (4 → 14). Suite 68 → **78**. |
| `docs/architecture.md` | Changelog entry **#11**. |
| `docs/progress.md` | Phase 4.7 row; guard-coverage note; two stale notes corrected. |

### One deviation from the spec, stated plainly

The spec named **one** new file (`scripts/env-preflight.ts`). I shipped **two**:
the pure resolver is split into `scripts/env-cascade.ts`. Reason: spec item 5
requires unit tests for cascade resolution, and `env-preflight.ts` calls
`process.exit(1)` at top level. If a test imported it, the import would kill the
test run. Splitting removes that hazard entirely rather than relying on
run-as-main detection.

### The core design point

`next dev` and `dotenv/config` do **not** resolve `DATABASE_URL` from the same
file. dotenv reads only `.env` and never clobbers a key already in
`process.env`; Next walks
`process.env > .env.$(NODE_ENV).local > .env.local > .env.$(NODE_ENV) > .env`
(`.env.local` skipped when `NODE_ENV=test`), per
`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`.

A single generic "read `.env` and check it" guard would therefore have been
**wrong for one of the two consumers** — either blocking safe local runs or
waving production through. Hence two explicit modes.

Two fail-closed decisions worth your attention:

1. **An env file that exists but cannot be read aborts** rather than being
   skipped. Skipping an unreadable *higher*-precedence file could let a
   lower-precedence local value win when the true resolution was production.
   That is the one skip that is not fail-closed. Pinned by a test (uses a
   directory to force `EISDIR`, since `chmod` is a no-op on Windows).
2. **`dotenv-expand` (`$VAR`) is not replicated.** The mismatch can only turn a
   proceed into an abort, never the reverse: changing a resolved *hostname*
   needs a `$VAR` inside the URL authority, and an unexpanded one leaves a `$`
   in the hostname, which is not on the allowlist.

---

## DEFINITION OF DONE — evidence

### 1. Blocked with the production `.env` present

No shell overrides (`DATABASE_URL`, `REDIS_URL`, `NODE_ENV` all confirmed unset).

```
> tsx scripts/env-preflight.ts --mode=dotenv --label=db:seed && tsx scripts/seed.ts
env-preflight db:seed [mode=dotenv, NODE_ENV=development]
  lookup order: process.env > .env
  DATABASE_URL host 'ep-mute-dawn-axywisfs-pooler.c-4.us-east-2.aws.neon.tech' from .env
  REDIS_URL    host 'coherent-martin-153299.upstash.io' from .env
SAFETY ABORT: this command truncates/writes the database named by DATABASE_URL — it must
point at a LOCAL instance (localhost, 127.0.0.1, ::1, [::1], host.docker.internal), but its
host is 'ep-mute-dawn-axywisfs-pooler.c-4.us-east-2.aws.neon.tech'. Point DATABASE_URL at
the local Docker Postgres or export a local value in your shell.
  (resolved from .env / .env for mode=dotenv; refused in 2 ms, before db:seed was spawned)
>>> npm run db:seed EXIT=1  wall=1289ms
```

All four, same shape:

| Command | Exit | Refused in | Mode |
|---|---|---|---|
| `npm run db:seed` | 1 | 2 ms | dotenv |
| `npm run db:push` | 1 | 1 ms | dotenv |
| `npm run db:migrate` | 1 | 2 ms | dotenv |
| `npm run dev` | 1 | 2 ms | next |

`npm run dev` also shows the longer ladder it searched:
`process.env > .env.development.local > .env.local > .env.development > .env`.

The 1–2 ms figures are the point: an abort at that speed cannot have completed a
DNS lookup, let alone a TCP connect. Wall time (~1.2 s) is npm + tsx startup.

### 2. No production connection opened during verification

Same four commands re-run with a sentinel exported
(`postgres://u@db.invalid/db`, `redis://db.invalid:6379`):

```
  DATABASE_URL host 'db.invalid' from process.env
  REDIS_URL    host 'db.invalid' from process.env
SAFETY ABORT: ... but its host is 'db.invalid'. ...
  (resolved from process.env / process.env for mode=dotenv; refused in 0 ms, before db:push was spawned)
>>> EXIT=1
```

All four exit 1 in 0–1 ms. So "does it really abort" is answered without ever
pointing tooling at production.

### 3. Unblocked with local DSNs

```
env-preflight db:seed [mode=dotenv, NODE_ENV=development]
  DATABASE_URL host 'localhost' from process.env
  REDIS_URL    host 'localhost' from process.env
  OK — local. Proceeding (0 ms).
Seed complete:
  categories:      3 (expected 3)
  active seasons:  3 (expected 3)
  creators:        0 (expected 0)
>>> EXIT=0
```

`db:migrate` → `[✓] migrations applied successfully!` EXIT=0.
`db:push` → `[i] No changes detected` EXIT=0.

`npm run dev` boots and serves a real board:

```
  OK — local. Proceeding (0 ms).
- Local:         http://localhost:3000
✓ Ready in 25.4s

GET /tech -> HTTP 200, 33010 bytes
@gamma @alpha @beta @delta @epsilon @zeta @eta @theta @iota   (document order)
season totals on page: $1,200 (#1 gamma), $1,050 (#2 alpha)
```

The demo board was rebuilt with the documented recipe (`db:seed` + nine
`dev:fake-bid` calls) after the suite truncation — ranks 1–9 landed
money-sorted exactly as `docs/progress.md:54` predicts.

### 4. No false aborts — the cascade is honored, not approximated

Temporary `.env.development.local` with local DSNs, `.env` untouched holding
prod, **no** shell overrides:

```
env-preflight dev [mode=next, NODE_ENV=development]
  lookup order: process.env > .env.development.local > .env.local > .env.development > .env
  DATABASE_URL host 'localhost' from .env.development.local
  REDIS_URL    host 'localhost' from .env.development.local
  OK — local. Proceeding (1 ms).
✓ Ready in 953ms
GET /tech -> HTTP 200
@gamma @alpha @iota
```

Stronger than self-agreement: the rendered rows exist **only in the local
database** (created by local fake-bids minutes earlier), so Next resolved the
same file the preflight did. The guard is not merely consistent with itself.

File removed afterwards — verified absent, and `.env` / `.env.local` untouched:

```
$ ls -la .env.development.local
ls: cannot access '.env.development.local': No such file or directory
$ ls -a | grep '^\.env'
.env  .env.example  .env.local
```

(It is covered by `.gitignore:24` (`.env*`) — confirmed with `git check-ignore -v`
before creating it, so it could never have been committed.)

### 5. Suite green

```
 Test Files  7 passed (7)
      Tests  78 passed (78)
```

68 → 78. `npx tsc --noEmit` exits 0. The 14 cases in `tests/env-guard.test.ts`
(4 pre-existing, unmodified, still green + 10 new):

```
✓ assertLocalEnv safety interlock > passes for every allowlisted local spelling
✓ ... > allows an unset REDIS_URL but not an unset DATABASE_URL
✓ ... > rejects production-shaped URLs naming the real host
✓ ... > rejects spoofs that hide localhost in userinfo, query, or fragment
✓ ... > assertLocalEnv is a thin process.env wrapper over the pure assertLocalDsns
✓ env cascade resolution > documents the exact file order per mode and NODE_ENV
✓ ... > walks the full next-mode precedence ladder as files are removed
✓ ... > lets a shell-exported value beat every file
✓ ... > ignores .env.local under NODE_ENV=test but still reads .env.test.local
✓ ... > reads only .env in dotenv mode, even when higher next-mode files exist
✓ ... > does NOT falsely abort when a local .env.development.local overrides a prod .env
✓ ... > fails closed on unset, unparseable, and exported-but-empty values
✓ ... > refuses to guess when a higher-precedence env file exists but cannot be read
✓ ... > treats an unset NODE_ENV as development (the `next dev` default)
```

The "does NOT falsely abort" case asserts both directions in one tree: `next`
mode resolves `.env.development.local` and passes, `dotenv` mode resolves `.env`
and aborts — proof the two modes are not interchangeable.

### 6. Deploy path unaffected

`npm run build` with prod-**shaped** non-local DSNs exported
(`ep-sentinel-shape-pooler.c-4.us-east-2.aws.neon.tech`,
`sentinel-shape-153299.upstash.io` — shaped like production, resolving to
nothing, so no real service is touched):

```
✓ Generating static pages using 11 workers (4/4) in 386ms
Route (app)  ƒ /  ○ /_not-found  ƒ /[category]  ƒ /api/board/[category]
             ƒ /api/checkout  ƒ /api/dev/fake-bid  ƒ /api/events  ƒ /api/health
             ƒ /api/inngest  ƒ /api/webhooks/stripe  ƒ /categories
>>> build EXIT=0
=== any SAFETY ABORT in the build path? === 0
```

Zero `SAFETY ABORT` occurrences. Note the build **does** touch Redis
(`[ioredis] getaddrinfo ENOTFOUND sentinel-shape-...` — non-fatal, expected with
a fake host): further reason the build must never be gated by a local-only
allowlist.

---

## Spec's open question, now answered

`db:generate` **does not need a live connection** — verified, so it stays
ungated on evidence rather than assumption:

```
$ DATABASE_URL='postgres://u@db.invalid/db' npm run db:generate
... 9 tables read from schema.ts ...
No schema changes, nothing to migrate 😴          EXIT=0

$ env -u DATABASE_URL -u REDIS_URL npx drizzle-kit generate
No schema changes, nothing to migrate 😴          EXIT=0
```

`git status` identical before and after — no migration file emitted.

---

## Out of scope, respected

- `next build` / `next start` / production runtime: **not gated** (verified).
- No credential rotated, edited, moved, or read beyond hostnames. No
  `vercel env pull`. No secret value appears in any output above or in any
  committed file.
- `.env.local` and its stale `VERCEL_OIDC_TOKEN` untouched.
- `src/lib/env.ts` (the never-built §1 zod validator) still not built — logged
  only, as specced.
- No SSE, settlement, schema, scoring, or UI change. Nothing Stripe.

### Two things I did that were not in the spec

1. **Started Docker Desktop.** It was not running, so `blowup-pg` /
   `blowup-redis` were down and DoD #3/#5 were unverifiable. Both containers
   have a restart policy and came up on their own; no container was created,
   destroyed, or reconfigured.
2. **Corrected two stale notes in `docs/progress.md`** while adding the 4.7
   row: the Phase-4 branch-topology note still said "3.5 still awaits owner
   merge", and the applyDelta finding still said "PENDING OWNER APPROVAL". Both
   are the same class of error that produced the bad handoff H2 fixed. Say the
   word if you would rather I revert those two edits.

### Side effect you should know about

The suite run for DoD #5 **truncated the local database**, as it always does. I
rebuilt the nine-creator demo board afterwards, so `/tech` is currently
populated and ready for the Phase 4.8 two-tab check.

---

## Waiting on you

Per your instruction I am stopping here and **not** starting Phase 4.8.

To review:

```bash
git log --oneline -3 && git diff 878a556..HEAD --stat
```

To reproduce the refusal yourself (safe — nothing connects):

```bash
npm run db:push
```

To reproduce the pass (adjust for PowerShell if that is your shell):

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5432/blowup' REDIS_URL='redis://localhost:6379' npm run db:seed
```

Branch is unpushed. Say push and I will open the PR.
