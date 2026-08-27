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
 */
export function applyDelta(
  rows: BoardRow[],
  evt: RankDeltaPayload,
): { next: BoardRow[]; moved: string[] } {
  const byId = new Map(rows.map((r) => [r.creatorId, r]));
  const moved: string[] = [];

  for (const e of evt.entries) {
    const prev = byId.get(e.creatorId);
    const newRank = e.newRank ?? prev?.rank ?? byId.size + 1;
    if (!prev || prev.rank !== newRank) moved.push(e.creatorId);

    // Day-start rank is preserved across updates: dayStart = rank + dayDelta
    // (dayDelta null ⇒ joined today). New-to-this-client creators are "new".
    let dayDelta: number | null = null;
    if (prev) {
      dayDelta =
        prev.dayDelta === null ? null : (prev.rank + prev.dayDelta) - newRank;
    }

    byId.set(e.creatorId, {
      creatorId: e.creatorId,
      rank: newRank,
      score: e.score,
      handle: prev?.handle && !e.handle ? prev.handle : e.handle || '(unknown)',
      name: e.name ?? prev?.name ?? null,
      avatarUrl: e.avatarUrl ?? prev?.avatarUrl ?? null,
      subscriberCount: e.subscriberCount ?? prev?.subscriberCount ?? null,
      bidTotalCents: e.bidTotalCents || prev?.bidTotalCents || 0,
      uniqueClicks: e.uniqueClicks || prev?.uniqueClicks || 0,
      dayDelta,
    });
  }

  return {
    next: [...byId.values()].sort(
      (a, b) => a.rank - b.rank || a.handle.localeCompare(b.handle),
    ),
    moved,
  };
}
