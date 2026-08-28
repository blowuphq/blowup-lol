import { describe, expect, it } from 'vitest';
import { applyDelta } from '../src/features/leaderboard/apply-delta.js';
import type { BoardRow } from '../src/features/leaderboard/board.js';
import type { RankDeltaPayload } from '../src/lib/sse.js';

/**
 * Phase 4.8 — the client-side merge behind the live board.
 *
 * The bug these pin: `features/leaderboard/events.ts` publishes
 * `entries: [entry]` — ALWAYS exactly one, the bidder. A displaced incumbent is
 * never told its rank moved, so before the fix two rows could both hold
 * `rank: 1` and ordering fell through to alphabetical handle order. Postgres and
 * the ZSET are correct throughout; only this view was wrong, and only when the
 * bidder's handle sorted AFTER the incumbent's — which is why it survived
 * Phase 4's demo (@gamma/@alpha happened to sort favourably).
 *
 * Pure functions, no DB — but tests/global-setup.ts still enforces local DSNs
 * for the whole suite.
 */

/** A board row with sensible defaults; only what a case cares about is passed. */
function row(over: Partial<BoardRow> & Pick<BoardRow, 'creatorId' | 'rank' | 'score' | 'handle'>): BoardRow {
  return {
    name: null,
    avatarUrl: null,
    subscriberCount: null,
    bidTotalCents: 10_000,
    uniqueClicks: 0,
    dayDelta: 0,
    ...over,
  };
}

type Entry = RankDeltaPayload['entries'][number];

/** A rank_delta payload; `activity` is irrelevant to the merge but part of the type. */
function evt(...entries: (Partial<Entry> & Pick<Entry, 'creatorId' | 'score'>)[]): RankDeltaPayload {
  return {
    type: 'rank_delta',
    entries: entries.map((e) => ({
      newRank: null,
      handle: '',
      name: null,
      avatarUrl: null,
      subscriberCount: null,
      bidTotalCents: 0,
      uniqueClicks: 0,
      ...e,
    })),
    activity: { type: 'bid', previousRank: null, newRank: null, amountCents: 0 },
  };
}

const order = (rows: BoardRow[]) => rows.map((r) => r.handle);
const ranks = (rows: BoardRow[]) => rows.map((r) => r.rank);

describe('applyDelta — single-entry rank_delta must resort the whole board', () => {
  /** The exact regression: bidder's handle sorts AFTER the incumbent's. */
  const alphaLeads = [
    row({ creatorId: 'a', rank: 1, score: 5.5, handle: '@alpha', bidTotalCents: 105_000 }),
    row({ creatorId: 'z', rank: 2, score: 4.0, handle: '@zeta', bidTotalCents: 40_000 }),
  ];

  it('demotes the displaced incumbent when @zeta overtakes @alpha', () => {
    const { next } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'z', newRank: 1, score: 6.0, handle: '@zeta', bidTotalCents: 120_000 }),
    );

    // Before the fix: @alpha stayed first and BOTH rows read rank 1.
    expect(order(next)).toEqual(['@zeta', '@alpha']);
    expect(ranks(next)).toEqual([1, 2]);
    expect(new Set(ranks(next)).size).toBe(next.length); // no duplicate numerals
  });

  it('reports every row whose rank changed as moved, not just the bidder', () => {
    const { moved } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'z', newRank: 1, score: 6.0, handle: '@zeta' }),
    );
    // The incumbent genuinely moved 1 -> 2; the flash must follow the contract
    // in the docstring ("ids whose rank changed"), or the row that visibly
    // dropped is the only one not highlighted.
    expect([...moved].sort()).toEqual(['a', 'z']);
  });

  it('leaves order and flashes untouched when a settlement changes nothing', () => {
    const { next, moved } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'a', newRank: 1, score: 5.5, handle: '@alpha', bidTotalCents: 105_000 }),
    );
    expect(order(next)).toEqual(['@alpha', '@zeta']);
    expect(ranks(next)).toEqual([1, 2]);
    expect(moved).toEqual([]);
  });

  it('preserves each row\'s day-start rank across a move (dayStart = rank + dayDelta)', () => {
    // alpha started the day at 1 (1 + 0); zeta started at 2 (2 + 0).
    const { next } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'z', newRank: 1, score: 6.0, handle: '@zeta' }),
    );
    const byHandle = new Map(next.map((r) => [r.handle, r]));

    const zeta = byHandle.get('@zeta')!;
    expect(zeta.rank).toBe(1);
    expect(zeta.dayDelta).toBe(1); // 2 - 1: up one
    expect(zeta.rank + zeta.dayDelta!).toBe(2);

    // The trap: the DISPLACED row's dayDelta must be recomputed too, or its
    // implied day-start silently shifts with its new rank.
    const alpha = byHandle.get('@alpha')!;
    expect(alpha.rank).toBe(2);
    expect(alpha.dayDelta).toBe(-1); // 1 - 2: down one
    expect(alpha.rank + alpha.dayDelta!).toBe(1);
  });

  it('keeps a null dayDelta null — "new today" is not a rank arithmetic result', () => {
    const rows = [
      row({ creatorId: 'a', rank: 1, score: 5.5, handle: '@alpha', dayDelta: null }),
      row({ creatorId: 'z', rank: 2, score: 4.0, handle: '@zeta', dayDelta: null }),
    ];
    const { next } = applyDelta(rows, evt({ creatorId: 'z', newRank: 1, score: 6.0, handle: '@zeta' }));
    expect(next.every((r) => r.dayDelta === null)).toBe(true);
  });

  it('places a creator new to this client by score and marks it new', () => {
    const { next } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'b', newRank: 2, score: 5.0, handle: '@bravo', bidTotalCents: 50_000 }),
    );
    expect(order(next)).toEqual(['@alpha', '@bravo', '@zeta']);
    expect(ranks(next)).toEqual([1, 2, 3]);
    expect(next[1]!.dayDelta).toBeNull(); // no prior rank => "new"
    expect(next[1]!.bidTotalCents).toBe(50_000);
    // @zeta was pushed down without being mentioned in the payload.
    expect(next[2]!.rank).toBe(3);
    expect(next[2]!.rank + next[2]!.dayDelta!).toBe(2);
  });

  it('resolves a byte-equal score tie deterministically, with no duplicate ranks', () => {
    // KNOWN LIMITATION, specced: the SSE `score` is the display score
    // (numeric(14,4)), not the tiebreak-folded ZSET score, so on an exact tie
    // the client cannot reproduce the server's firstBidOrdinal ordering. It
    // falls back to rank-carried-in, then handle — stable and duplicate-free,
    // and the next refetch/reconcile heals any disagreement.
    const { next } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'z', newRank: 1, score: 5.5, handle: '@zeta' }),
    );
    expect(next).toHaveLength(2);
    expect(ranks(next)).toEqual([1, 2]);
    expect(order(next)).toEqual(['@alpha', '@zeta']);
  });

  it('sorts by score even when newRank is absent', () => {
    // newRank is `number | null` on the wire. A null must not pin a row in
    // place — the absolute score is the authority.
    const { next } = applyDelta(
      alphaLeads,
      evt({ creatorId: 'z', newRank: null, score: 9.0, handle: '@zeta' }),
    );
    expect(order(next)).toEqual(['@zeta', '@alpha']);
    expect(ranks(next)).toEqual([1, 2]);
  });

  it('stays correct for a multi-entry payload (forward-compatible)', () => {
    const rows = [
      row({ creatorId: 'a', rank: 1, score: 9.0, handle: '@alpha' }),
      row({ creatorId: 'b', rank: 2, score: 6.0, handle: '@bravo' }),
      row({ creatorId: 'c', rank: 3, score: 3.0, handle: '@charlie' }),
    ];
    const { next, moved } = applyDelta(
      rows,
      evt(
        { creatorId: 'c', newRank: 1, score: 12.0, handle: '@charlie' },
        { creatorId: 'a', newRank: 3, score: 4.0, handle: '@alpha' },
      ),
    );
    expect(order(next)).toEqual(['@charlie', '@bravo', '@alpha']);
    expect(ranks(next)).toEqual([1, 2, 3]);
    // @bravo held rank 2 before and after, so it did NOT move — only the two
    // rows that actually swapped ends should flash.
    expect([...moved].sort()).toEqual(['a', 'c']);
  });

  it('carries display fields forward when the payload omits them', () => {
    const rows = [
      row({
        creatorId: 'a',
        rank: 1,
        score: 5.5,
        handle: '@alpha',
        name: 'Alpha Channel',
        avatarUrl: 'https://example.test/a.png',
        subscriberCount: 1234,
        uniqueClicks: 7,
      }),
    ];
    const { next } = applyDelta(rows, evt({ creatorId: 'a', newRank: 1, score: 7.0 }));
    expect(next[0]).toMatchObject({
      handle: '@alpha',
      name: 'Alpha Channel',
      avatarUrl: 'https://example.test/a.png',
      subscriberCount: 1234,
      uniqueClicks: 7,
      score: 7.0,
      rank: 1,
    });
  });
});
