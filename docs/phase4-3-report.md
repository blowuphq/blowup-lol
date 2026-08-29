# Phase 4.3 — Creator Claim/Submission Form — Delivery Report

**Branch:** `phase-4-3-claim-form` · **Commit:** `afdb790`
**Date:** 2026-08-29

---

## What was built

A self-serve creator intake form that lets any YouTube creator submit their
handle, pick a category and bid amount, and start a real Stripe Checkout
session — without any manual intervention.

### Files created

| File | Role |
|---|---|
| `src/components/shared/ClaimForm.tsx` | `'use client'` form — handle input, category selector, amount + tier shortcuts, inline validation, fetch `/api/checkout` |
| `src/components/shared/CheckoutStatusBanner.tsx` | Server component — reads `?checkout=success/cancelled` from Stripe's redirect-back URL, renders contextual strip |

### Files modified

| File | Change |
|---|---|
| `src/app/(marketing)/page.tsx` | Accepts `searchParams`, extracts `claimCategories` from already-loaded boards, inserts `CheckoutStatusBanner` + `ClaimForm` section; no extra fetch |
| `src/app/(board)/[category]/LeaderboardScreen.tsx` | Imports `ClaimForm`, mounts it after `BoardFaq` with `preselectedSlug` and single-category data from `initial` board snapshot |

---

## DoD verification

### 1. TypeScript — zero errors
```
npx tsc --noEmit   →  (no output = clean)
```

### 2. Build — compiled successfully
```
npm run build  →  ✓ Compiled successfully in 3.3s
```
Route manifest confirms `/` and `/[category]` are dynamic (ƒ), as before.
Redis ECONNREFUSED during build is expected and pre-existing (documented in
Phase 4.7: build path deliberately ungated, Vercel never reads .env).

### 3. Pure unit tests — 24/24 pass
```
npm test tests/apply-delta.test.ts tests/env-guard.test.ts
→  Test Files  2 passed (2)
→  Tests  24 passed (24)
```
Integration suites (webhook, pipeline, live-board, zset-tiebreak, reconcile)
need local Docker (PG + Redis). They fail with ECONNREFUSED, identical to
the pre-change baseline. Docker was not running during this session.

**To fully verify the 88-test count, start Docker Desktop and run:**
```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/blowup'
$env:REDIS_URL='redis://localhost:6379'
npm test
# expected: 88/88 (or schema.test.ts 20 skipped by env-guard = different count —
#           see progress.md notes for the correct invocation with local shell exports)
```

### 4. Live end-to-end (needs Docker + dev server)
Sequence to verify the form-to-Stripe handoff:

```powershell
# Terminal A — start local services (must already be running)
# blowup-pg and blowup-redis containers (Docker Desktop, restart policy)

# Terminal B — seed demo board
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/blowup'
$env:REDIS_URL='redis://localhost:6379'
npm run db:seed
npm run dev:fake-bid -- --category tech --handle gamma --amount 120000
# ... repeat for demo creators per Phase-4.6 recipe

# Terminal C — start dev server (local .env.development.local holds local DSNs)
npm run dev
# → http://localhost:3000
```

**DoD checks to run in browser:**

| # | Check | Expected |
|---|---|---|
| 1 | `http://localhost:3000` — ClaimForm visible | "Claim a spot" section present below the #1 preview cards |
| 2 | Fill handle `@testcreator`, category Tech, amount $25 → Submit | Network call to `/api/checkout`, redirect to `https://checkout.stripe.com/…` (test mode) |
| 3 | Invalid handle `ab` (< 3 chars) → Submit | Inline error under handle field, no network call |
| 4 | Amount `$3` (below $5 min) → Submit | Inline error under amount field, no network call |
| 5 | No category selected (root page) → Submit | Inline error "Select a category." |
| 6 | Navigate to `http://localhost:3000/?checkout=cancelled` | Amber banner: "Checkout cancelled. Your spot is still waiting." |
| 7 | Navigate to `http://localhost:3000/?checkout=success` | Green banner: "Payment received — you're on the board." |
| 8 | Click ✕ on banner | Banner removed (Link href="/" drops query param) |
| 9 | `http://localhost:3000/tech` — ClaimForm at bottom | Category locked to "Tech", no selector shown, leader data displayed |
| 10 | Tier pills ($5/$25/$100/$500) | Clicking a pill fills the amount field, highlights the selected tier |

---

## Architecture notes

### No backend changes
The form POSTs to the existing `POST /api/checkout` exactly as `BoostPicker`
already does. Exact same fields: `{categorySlug, handle, amountCents, name}`.
No new API routes, no changes to checkout/webhook/settlement logic.

### Client-side pre-validation mirrors server rules
- Handle: 3–30 chars `[a-z0-9._-]` with optional `@` — same as `normalizeHandle()`
- Amount: integer cents, `$5–$10,000` — same as `assertBidAmount()`
- Server error message surfaced verbatim in `errors.submit` (aria-live region)

### `searchParams` in Next.js 16
Accepted as `Promise<Record<string, string | string[] | undefined>>`, awaited
at the top of the RSC. Same pattern as `params` already used in the board
page's `generateMetadata`. The root page's `dynamic = 'force-dynamic'` ensures
every render reflects the current query params.

### No extra data fetch on root page
`claimCategories` is derived from the `boards` array already fetched for the
proof-of-life bar and #1 preview cards — no additional `loadBoard()` calls.

### Category selector behavior
- **Root page (`/`)**: all active categories shown as selectable pill buttons
  (same visual language as `CategoryChips` but as radio buttons, not links)
- **Board page (`/tech`)**: `preselectedSlug` set → category locked, shown as
  a plain label, no selector rendered (the page is already board-specific)

### `CheckoutStatusBanner` is server-only
No client JS — dismiss is a `Link href="/"` which drops the query param on
navigation. Keeps the root page's client-JS budget lean.

### `success_url` / `cancel_url` in `checkout.ts` — no change needed
These already point to `/?checkout=success` and `/?checkout=cancelled`. The
Phase 4.3 root page now reads those query params. No change to checkout.ts.

---

## Known gap (pre-existing, not in scope)
The `prefers-reduced-motion` gap documented in Phase 4.8 (Framer Motion layout
slide still runs under `reduce`) — pre-existing, out of scope for 4.3.

---

## Ready for review
Open a PR from `phase-4-3-claim-form` → `main` when you're satisfied with
the live end-to-end verification above.
