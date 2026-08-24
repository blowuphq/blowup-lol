# Phase 2 Report — Ranking Pipeline (Fake-Bid → PG → Redis)

Status: DELIVERED 2026-08-24 · Implementation: commit `3d51128` (`v0.2-phase2`) ·
Tests: **29/29 green** (20 schema + 9 pipeline)

Demonstrated end-to-end with dev-only fake bids (no Stripe): a Bid insert flows
through SUM-derived campaign totals → public 85/15 log-weighted score →
whole-season rank recompute under an advisory lock → activity rows → Redis ZADD,
and the Redis projection is verified against independent Postgres computation.

> Note: the outputs below were captured by replaying the exact demo script
> (same five bids) against a clean database; the original chat-session run was
> identical in behavior but was truncated for display.

---

## DoD 1 — Five fake bids across three creators order correctly

Bids fired via `npm run dev:fake-bid -- tech '<handle>' <cents>` into the seeded
`tech` category:

| # | Creator | Bid | Campaign total | Score | prevRank → newRank | Activity |
|---|---|---|---|---|---|---|
| 1 | @ada   | $5   | $5    | 1.5230 | null → 1 | joined_board |
| 2 | @ada   | $20  | $25   | 2.7694 | 1 → 1    | bid |
| 3 | @grace | $500 | $500  | 5.2841 | null → 1 | joined_board |
| 4 | @linus | $100 | $100  | 3.9229 | null → 2 | joined_board |
| 5 | @grace | $5   | $505  | 5.2926 | 1 → 1    | bid |

Actual pipeline JSON from bid 3 (@grace's $500 whale bid taking rank 1):

```json
{
  "bid": "3624e705-49b7-4ba5-ba77-e11f0e9bb22d",
  "category": "tech",
  "creator": "775d2057-f863-43ad-a28b-ddf2e1a4c134",
  "bidAmountCents": 50000,
  "paymentStatus": "succeeded (fake)",
  "previousRank": null,
  "newRank": 1,
  "score": 5.2841,
  "campaignTotalCents": 50000,
  "activity": "joined_board"
}
```

Resulting leaderboard is money-heavy-first, exactly as the formula dictates:
**@grace $505 > @linus $100 > @ada $25**.

## DoD 2 — Postgres vs Redis agreement

`npm run dev:leaderboard -- tech` runs `verifyLeaderboard()`: it reads Redis via
`ZREVRANGE <key> 0 -1 WITHSCORES`, recomputes ordering independently in Postgres
(`ORDER BY score DESC, first_succeeded_bid ASC NULLS LAST, campaign_id ASC`),
and compares membership, position-by-position order, and scores (tolerance 1e-9).
Actual output:

```text
Leaderboard 'tech' (season d2ec3e09-b429-48e5-a106-e248e56c05ac)

Redis projection (ZREVRANGE blowup:lb:*):
   1. @grace  score=5.2926
   2. @linus  score=3.9229
   3. @ada  score=2.7694

Postgres truth (ORDER BY score DESC, first_bid ASC, id):
   1. @grace         score=5.2926     total=$505.00 firstBid=2026-08-24 16:44:58.480679+00
   2. @linus         score=3.9229     total=$100.00 firstBid=2026-08-24 16:45:00.01026+00
   3. @ada           score=2.7694     total=$25.00 firstBid=2026-08-24 16:44:55.670407+00

MATCH: YES — Redis agrees with Postgres
```

The command exits 1 on any mismatch, so it doubles as a smoke check.
(The script also repairs a poisoned season pointer from PG truth — covered by a
dedicated test.)

## DoD 3 — Activity rows with correct previousRank/newRank

Raw rows as stored (via `SELECT row_to_json(activities)`):

```json
{"id":3,"season_id":"d2ec3e09-…","creator_id":"775d2057-…","type":"joined_board","amount_cents":50000,"previous_rank":null,"new_rank":1,"created_at":"2026-08-24T16:44:58.480679+00:00"}
{"id":5,"season_id":"d2ec3e09-…","creator_id":"775d2057-…","type":"bid","amount_cents":500,"previous_rank":1,"new_rank":1,"created_at":"2026-08-24T16:45:01.368617+00:00"}
```

Full chronological feed (from `npm run dev:activity -- tech`):

```text
2026-08-24 16:44:55.67+00  @ada     joined_board  bid=$5.00   prevRank=null newRank=1
2026-08-24 16:44:57.10+00  @ada     bid           bid=$20.00  prevRank=1    newRank=1
2026-08-24 16:44:58.48+00  @grace   joined_board  bid=$500.00 prevRank=null newRank=1
2026-08-24 16:45:00.01+00  @linus   joined_board  bid=$100.00 prevRank=null newRank=2
2026-08-24 16:45:01.36+00  @grace   bid           bid=$5.00   prevRank=1    newRank=1
```

Type mapping per architecture §5: first entry on board → `joined_board`
(`previous_rank` NULL); rank moved → `rank_change`; no rank change → `bid`.
Creators pushed down by a joiner update silently with **no** activity row — by
design (visible above: @ada gets no row when @grace takes rank 1).

## DoD 4 — Race-condition analysis

Full analysis lives in [`phase2-race-risks.md`](./phase2-race-risks.md). Headline:

- **Proven safe by tests:** advisory-lock write serialization (distinct ranks,
  coherent projection under `Promise.all` races), single-transaction atomicity,
  SUM-derived totals, PG-commits-before-ZADD ordering.
- **R1 (top residual):** crash between PG commit and Redis ZADD leaves the
  projection stale until the next bid or manual verify — reconciler planned.
- **Gate recorded:** do not ship SSE (Phase 4) before that reconciler exists,
  because `safeZadd` deliberately fails open (logs, never blocks truth).
- Also documented: exact-score ties can order differently Redis vs PG;
  season-wide lock as throughput ceiling; float64-vs-numeric notes.

## Issues found & fixed during Phase 2 (permanent record)

These existed only in session scrollback until now:

1. **Redis read used `ZRANGE` (ascending)** — projection came back lowest-score
   first. Fixed to `ZREVRANGE`; caught by the verifier's position check.
2. **Raw-SQL alias casing** — `getPostgresBoard` selected `creator_id AS …`
   snake_case while mapping camelCase keys, yielding `creatorId: undefined`.
   Fixed aliases to `"creatorId"`, `"bidTotalCents"`, `"firstBidAt"`.
3. **timestamptz interop** — under drizzle `db.execute`, timestamps arrive as
   strings, not `Date`s; typed honestly (`firstBidAt: string | null`) and fixed
   the CLI printer instead of assuming pg's default parsing.
4. **Test-file parallelism** — running both suites together failed 19/29
   because each file's `TRUNCATE` hit the other's fixtures on the shared dev DB.
   Fixed with `fileParallelism: false` in `vitest.config.ts` (commented why).

## Scope discipline

No Stripe, no UI, no YouTube API, no SSE touched. One addition beyond the stated
scripts: `scripts/dev-activity.ts` (DoD-3 evidence query), kept as a reusable
dev tool.
