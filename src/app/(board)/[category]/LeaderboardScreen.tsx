'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardRow, BoardSnapshot } from '../../../features/leaderboard/board.js';
import type { RankDeltaPayload } from '../../../lib/sse.js';
import { applyDelta } from '../../../features/leaderboard/apply-delta.js';
import { LeaderboardRow, Avatar } from '../../../components/shared/LeaderboardRow.js';
import { VisitorCount } from '../../../components/shared/VisitorCount.js';
import { ScoreFormula } from '../../../components/shared/ScoreFormula.js';
import {
  CategoryChips,
  type CategoryChipData,
} from '../../../components/shared/CategoryChips.js';
import { BoardFaq } from '../../../components/shared/BoardFaq.js';

/**
 * The live board (architecture §3 Phase C): SSR renders current truth, an
 * EventSource applies rank deltas as bids settle, Framer Motion FLIPs rows
 * into their new positions with a flash on whatever moved. Reconnects replay
 * via Last-Event-ID (handled by the browser + /api/events), then one fresh
 * snapshot fetch resyncs absolute state — idempotent because events carry
 * full row state, never diffs.
 *
 * The merge itself lives in features/leaderboard/apply-delta.ts so it can be
 * unit-tested outside this client boundary.
 */

const fmtEnd = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export default function LeaderboardScreen({
  initial,
  chips,
}: {
  initial: BoardSnapshot;
  chips?: CategoryChipData[];
}) {
  const [rows, setRows] = useState<BoardRow[]>(initial.rows);
  const [visitors, setVisitors] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const seqRef = useRef(0);
  const slug = initial.slug;

  // Proof-of-life total: rows carry ABSOLUTE bid totals, so this recomputes
  // correctly as deltas land — no extra subscription, no lib changes.
  const totalRaisedCents = useMemo(
    () => rows.reduce((sum, r) => sum + r.bidTotalCents, 0),
    [rows],
  );

  useEffect(() => {
    const es = new EventSource(`/api/events?category=${encodeURIComponent(slug)}`);

    es.onopen = () => {
      setLive(true);
      // §3C "one fresh fetch": after every (re)connect, resync onto absolute
      // truth. Debounced so it lands AFTER any replayed backlog.
      setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) return;
        fetch(`/api/board/${encodeURIComponent(slug)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((snap: BoardSnapshot | null) => {
            if (snap) setRows(snap.rows);
          })
          .catch(() => {});
      }, 400);
    };
    es.onerror = () => setLive(false);

    es.addEventListener('rank_delta', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as RankDeltaPayload;
      setRows((rs) => {
        const { next, moved } = applyDelta(rs, payload);
        if (moved.length > 0) {
          const seq = ++seqRef.current;
          setFlash((f) => ({ ...f, ...Object.fromEntries(moved.map((id) => [id, seq])) }));
        }
        return next;
      });
    });

    es.addEventListener('visitors', (ev) => {
      const count = (JSON.parse((ev as MessageEvent).data) as { count: number }).count;
      setVisitors(count);
    });

    return () => es.close();
  }, [slug]);

  const leader = rows[0];

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[30rem] w-[58rem] -translate-x-1/2 rounded-full bg-hot/20 blur-[150px]"
      />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            BLOWUP<span className="text-hot">.</span>
          </Link>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest ${
                live
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-zinc-500'}`}
              />
              {live ? 'Live' : 'Reconnecting'}
            </span>
          </div>
        </header>

        {/* Category chips — one-tap board switching with per-category totals */}
        {chips && chips.length > 0 && (
          <div className="mt-5">
            <CategoryChips chips={chips} activeSlug={slug} />
          </div>
        )}

        {/* Title */}
        <section className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-hot">
            Weekly battlefield
          </p>
          <h1 className="mt-1 text-[clamp(2.75rem,8vw,5rem)] font-bold uppercase leading-none tracking-tighter">
            {initial.categoryName}
          </h1>
          {/* Proof-of-life line (Phase 4.5, item 3): one compact row — live
              viewers, season total, round end. Total updates as deltas land. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-zinc-500">
            <VisitorCount count={visitors} />
            <span aria-hidden>·</span>
            <span>
              <span className="font-bold tabular-nums text-zinc-200">
                ${(totalRaisedCents / 100).toLocaleString('en-US')}
              </span>{' '}
              raised this season
            </span>
            <span aria-hidden>·</span>
            <span>Round ends {fmtEnd(initial.seasonEndsAt)} · UTC</span>
          </div>
          {initial.source === 'postgres' && (
            <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              Live projection unreachable — showing Postgres truth; updates may be delayed.
            </p>
          )}
        </section>

        {/* Rows */}
        <section className="mt-8 space-y-2.5" aria-label={`${initial.categoryName} leaderboard`}>
          {rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
              <p className="text-lg font-bold">No bidders yet.</p>
              <p className="mt-1 text-sm text-zinc-500">
                The board resets weekly — first successful bid takes #1.
              </p>
            </div>
          )}
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <LeaderboardRow
                key={row.creatorId}
                row={row}
                slug={slug}
                flashSeq={flash[row.creatorId]}
              />
            ))}
          </AnimatePresence>
        </section>

        {/* Formula transparency + leader spotlight */}
        <div className="mt-10 grid gap-4 sm:grid-cols-5">
          <div className="sm:col-span-2 rounded-xl border border-hot/30 bg-gradient-to-br from-hot/15 to-transparent p-5">
            <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-hot">
              Current #1
            </h2>
            {leader ? (
              <div className="mt-4 flex items-center gap-3">
                <Avatar handle={leader.handle} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{leader.handle}</p>
                  <p className="text-sm tabular-nums text-zinc-400">
                    {leader.score.toFixed(4)} pts · ${(leader.bidTotalCents / 100).toLocaleString('en-US')}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-400">Unclaimed — place the first bid.</p>
            )}
          </div>
          <div className="sm:col-span-3">
            <ScoreFormula leader={leader} />
          </div>
        </div>

        {/* Plain-English FAQ — supplements the formula panel, collapsed by default */}
        <BoardFaq />

        <footer className="mt-12 flex items-center justify-between text-xs uppercase tracking-widest text-zinc-600">
          <Link href="/categories" className="transition-colors hover:text-hot">
            All categories →
          </Link>
          <span>blowup.lol</span>
        </footer>
      </div>
    </main>
  );
}
