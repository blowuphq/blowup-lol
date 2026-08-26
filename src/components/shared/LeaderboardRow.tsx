'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { BoardRow } from '../../features/leaderboard/board.js';
import { BoostPicker, BoostTrigger } from './BidButton.js';
import { Avatar } from './Avatar.js';

// Re-exported so existing importers (categories index, root page) keep their
// import path; new server components should import './Avatar.js' directly to
// stay outside this module's framer-motion client boundary.
export { Avatar };

/**
 * One rank row (architecture §1 components/shared/LeaderboardRow). The
 * parent wraps it in a Framer Motion `layout` container so bid-driven
 * reorderings visibly SLIDE rows past each other; a flash overlay keyed by
 * the triggering event re-highlights whichever rows moved.
 *
 * Phase 4.5: ranks 1–3 get podium treatment (larger avatar/numeral/score,
 * medal-tinted gradient) while staying in the SAME layout parent — the
 * size/styling delta is class-conditional, so a row sliding between #3 and
 * #4 still animates smoothly instead of jumping between containers.
 * Every row carries an inline Boost CTA into the existing checkout flow.
 */

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

/** Medal-tinted card treatment for the podium; quiet card for everyone else. */
const PODIUM_CARD: Record<number, string> = {
  1: 'border-hot/60 bg-gradient-to-r from-hot/[0.14] via-hot/[0.05] to-transparent shadow-[0_0_28px_rgba(255,64,23,0.18)]',
  2: 'border-zinc-300/30 bg-gradient-to-r from-zinc-300/[0.09] to-transparent',
  3: 'border-amber-500/40 bg-gradient-to-r from-amber-500/[0.09] to-transparent',
};
const FIELD_CARD = 'border-white/5 bg-white/[0.03]';

export function LeaderboardRow({
  row,
  slug,
  flashSeq,
}: {
  row: BoardRow;
  slug: string;
  flashSeq?: number;
}) {
  const [boostOpen, setBoostOpen] = useState(false);
  const podium = row.rank <= 3;
  const money = `$${(row.bidTotalCents / 100).toLocaleString('en-US')}`;
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 480, damping: 42, mass: 0.9 }}
      className={`relative overflow-hidden rounded-xl border ${
        podium ? (PODIUM_CARD[row.rank] ?? FIELD_CARD) : FIELD_CARD
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
      <div
        className={`flex flex-wrap items-center gap-4 px-4 sm:gap-5 sm:px-5 ${
          podium ? 'py-4 sm:py-5' : 'py-3 sm:py-3.5'
        }`}
      >
        <span
          className={`w-12 shrink-0 text-center font-bold tabular-nums leading-none tracking-tighter sm:w-14 ${
            podium ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'
          } ${RANK_STYLES[row.rank] ?? 'text-zinc-500'}`}
        >
          {row.rank}
        </span>
        <Avatar handle={row.handle} size={podium ? 'lg' : 'md'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={`truncate font-bold tracking-tight ${
                podium ? 'text-lg sm:text-xl' : 'text-base sm:text-lg'
              }`}
            >
              {row.handle}
            </span>
            <DeltaBadge row={row} />
          </div>
          <div
            className={`mt-0.5 flex items-center gap-2 text-xs text-zinc-500 ${
              podium ? 'sm:text-sm' : ''
            }`}
          >
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
          <div
            className={`font-bold tabular-nums leading-none tracking-tight ${
              podium ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'
            }`}
          >
            {row.score.toFixed(4)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">score</div>
        </div>
        <BoostTrigger handle={row.handle} onOpen={() => setBoostOpen(true)} />
      </div>
      {boostOpen && (
        <BoostPicker
          slug={slug}
          handle={row.handle}
          onClose={() => setBoostOpen(false)}
        />
      )}
    </motion.div>
  );
}
