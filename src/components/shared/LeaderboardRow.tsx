'use client';

import { motion } from 'framer-motion';
import type { BoardRow } from '../../features/leaderboard/board.js';

/**
 * One rank row (architecture §1 components/shared/LeaderboardRow). The
 * parent wraps it in a Framer Motion `layout` container so bid-driven
 * reorderings visibly SLIDE rows past each other; a flash overlay keyed by
 * the triggering event re-highlights whichever rows moved.
 */

/** Deterministic avatar gradient — no YouTube API dependency for V1 boards. */
const GRADIENTS = [
  'from-[#ff4017] to-[#ffb03a]',
  'from-[#8b5cf6] to-[#ec4899]',
  'from-[#06b6d4] to-[#3b82f6]',
  'from-[#10b981] to-[#84cc16]',
  'from-[#f43f5e] to-[#f97316]',
];

function gradientFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function Avatar({ handle, size = 'md' }: { handle: string; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-11 w-11 text-base';
  return (
    <div
      aria-hidden
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(handle)} font-bold text-white shadow-lg shadow-black/40`}
    >
      {(handle.replace(/^@/, '') || '?')[0].toUpperCase()}
    </div>
  );
}

function DeltaBadge({ row }: { row: BoardRow }) {
  if (row.dayDelta === null) {
    return (
      <span className="rounded-full bg-hot/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-hot">
        New today
      </span>
    );
  }
  if (row.dayDelta > 0) {
    return (
      <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
        ▲ up {row.dayDelta} today
      </span>
    );
  }
  if (row.dayDelta < 0) {
    return (
      <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-400">
        ▼ down {-row.dayDelta} today
      </span>
    );
  }
  return <span className="text-xs uppercase tracking-wider text-zinc-600">— holding</span>;
}

const RANK_STYLES: Record<number, string> = {
  1: 'text-hot drop-shadow-[0_0_18px_rgba(255,64,23,0.55)]',
  2: 'text-zinc-200',
  3: 'text-amber-500',
};

export function LeaderboardRow({
  row,
  flashSeq,
}: {
  row: BoardRow;
  flashSeq?: number;
}) {
  const money = `$${(row.bidTotalCents / 100).toLocaleString('en-US')}`;
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 480, damping: 42, mass: 0.9 }}
      className={`relative overflow-hidden rounded-xl border bg-white/[0.03] ${
        row.rank === 1 ? 'border-hot/60 shadow-[0_0_28px_rgba(255,64,23,0.18)]' : 'border-white/5'
      }`}
    >
      {/* move-flash overlay — remounted per event so the animation always replays */}
      {flashSeq !== undefined && (
        <span
          key={flashSeq}
          aria-hidden
          className="flash-overlay pointer-events-none absolute inset-0 z-10"
        />
      )}
      <div className="flex items-center gap-4 px-4 py-3.5 sm:gap-5 sm:px-5">
        <span
          className={`w-12 shrink-0 text-center text-3xl font-bold tabular-nums leading-none tracking-tighter sm:text-4xl ${
            RANK_STYLES[row.rank] ?? 'text-zinc-500'
          }`}
        >
          {row.rank}
        </span>
        <Avatar handle={row.handle} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-base font-bold tracking-tight sm:text-lg">
              {row.handle}
            </span>
            <DeltaBadge row={row} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>{money} raised</span>
            {row.subscriberCount != null && (
              <>
                <span aria-hidden>·</span>
                <span>{row.subscriberCount.toLocaleString('en-US')} subs</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold tabular-nums leading-none tracking-tight sm:text-2xl">
            {row.score.toFixed(4)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">score</div>
        </div>
      </div>
    </motion.div>
  );
}
