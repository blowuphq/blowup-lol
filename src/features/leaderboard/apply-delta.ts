import type { BoardRow } from './board.js';
import type { RankDeltaPayload } from '../../lib/sse.js';

/**
 * Merges a settlement's `rank_delta` entries into a client's local row state.
 *
 * Extracted from LeaderboardScreen.tsx so it can be unit-tested: the vitest
 * suite runs in the node environment with no jsdom, so this logic was
 * unreachable while it sat inside a 'use client' component next to
 * framer-motion and next/link imports. Same precedent as the Phase-4.6 Avatar
 * extraction. Type-only imports keep this module free of any runtime edge —
 * importing `board.js` for values would drag in the db client.
 *
 * Pure: no React, no DOM, no I/O. Returns fresh rows plus the ids whose rank
 * changed, which the component turns into flash highlights.
 *
 * WHY IT RESORTS THE WHOLE BOARD (Phase 4.8)
 * `features/leaderboard/events.ts` publishes `entries: [entry]` — always
 * exactly one, the bidder. Nobody tells the *displaced* incumbent that its
 * rank moved. Trusting the per-entry `newRank` alone therefore left two rows
 * holding the same rank, and the old `a.rank - b.rank` sort fell through to
 * alphabetical handle order: if @zeta overtook @alpha, the client kept @alpha
 * visually at #1 and rendered "1" twice until a reconnect refetch healed it.
 * Server truth (Postgres + the ZSET) was correct throughout.
 *
 * The fix is to treat `score` as the authority — events carry ABSOLUTE scores,
 * which is what makes replay idempotent — and derive rank from position.
 */
export function applyDelta(
  rows: BoardRow[],
  evt: RankDeltaPayload,
): { next: BoardRow[]; moved: string[] } {
  /** Pre-event state, never mutated: the baseline for `moved` and day-starts. */
  const before = new Map(rows.map((r) => [r.creatorId, r]));

  /**
   * Day-start rank per creator, captured BEFORE any rank is reassigned:
   * `dayStart = rank + dayDelta` (null ⇒ joined today). Ranks are now assigned
   * after sorting, so dayDelta has to be recomputed against the final rank —
   * including for rows this payload never mentioned. Skipping them would let a
   * displaced row's implied day-start drift along with its new rank.
   */
  const dayStart = new Map<string, number | null>(
    rows.map((r) => [r.creatorId, r.dayDelta === null ? null : r.rank + r.dayDelta]),
  );

  const merged = new Map(before);

  for (const e of evt.entries) {
    const prev = merged.get(e.creatorId);
    // Rank carried into the sort — used only as a tiebreak below, no longer as
    // the primary ordering key.
    const carriedRank = e.newRank ?? prev?.rank ?? merged.size + 1;

    merged.set(e.creatorId, {
      creatorId: e.creatorId,
      rank: carriedRank,
      score: e.score,
      handle: prev?.handle && !e.handle ? prev.handle : e.handle || '(unknown)',
      name: e.name ?? prev?.name ?? null,
      avatarUrl: e.avatarUrl ?? prev?.avatarUrl ?? null,
      subscriberCount: e.subscriberCount ?? prev?.subscriberCount ?? null,
      bidTotalCents: e.bidTotalCents || prev?.bidTotalCents || 0,
      uniqueClicks: e.uniqueClicks || prev?.uniqueClicks || 0,
      dayDelta: null, // assigned below, once the final rank is known
    });
  }

  /**
   * Score descending, then carried-in rank, then handle.
   *
   * KNOWN LIMITATION: the SSE `score` is the DISPLAY score (`numeric(14,4)`),
   * not the tiebreak-folded ZSET score (`score − 1e-11·firstBidOrdinal`, Phase
   * 3.5 R3). On a byte-equal tie the client therefore cannot reproduce the
   * server's first-bid ordering. The two fallbacks make the result stable and
   * duplicate-free rather than correct-by-construction; any disagreement heals
   * on the next §3C refetch or reconciler pass. Publishing `firstBidOrdinal`
   * in the payload was considered and rejected in the Phase 4.8 spec.
   */
  const sorted = [...merged.values()].sort(
    (a, b) => b.score - a.score || a.rank - b.rank || a.handle.localeCompare(b.handle),
  );

  const next: BoardRow[] = [];
  const moved: string[] = [];

  sorted.forEach((row, i) => {
    const rank = i + 1;
    // Absent from the map ⇒ new to this client ⇒ "new" rather than a delta.
    const start = dayStart.get(row.creatorId) ?? null;
    next.push({ ...row, rank, dayDelta: start === null ? null : start - rank });

    const wasAt = before.get(row.creatorId);
    if (!wasAt || wasAt.rank !== rank) moved.push(row.creatorId);
  });

  return { next, moved };
}
