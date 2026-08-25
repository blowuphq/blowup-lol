import { BID_TIERS_CENTS, SCORE_WEIGHTS } from '../../config/site.js';
import { computeScore } from '../../lib/rank-formula.js';
import type { BoardRow } from '../../features/leaderboard/board.js';

/**
 * The transparency requirement (architecture §0/§3): the public ranking
 * formula displayed ON THE BOARD, rendered from the SAME constants the
 * scorer executes (`SCORE_WEIGHTS` + `computeScore`) — displayed ≠ executed
 * is structurally impossible (§1). The worked example is COMPUTED LIVE from
 * the current #1's real inputs, so what the panel claims always matches
 * what the ranking shows.
 */
export function ScoreFormula({ leader }: { leader: BoardRow | undefined }) {
  const wB = SCORE_WEIGHTS.W_BID;
  const wE = SCORE_WEIGHTS.W_ENG;

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
        How ranking works
      </h2>
      <p className="mt-3 font-mono text-sm leading-relaxed text-zinc-300 sm:text-base">
        score ={' '}
        <span className="text-hot">
          {wB} · ln(1 + $ raised)
        </span>{' '}
        +{' '}
        <span className="text-cyan-400">
          {wE} · ln(1 + verified clicks)
        </span>
      </p>

      <ul className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
        {BID_TIERS_CENTS.map((c) => (
          <li key={c} className="rounded-md border border-white/10 px-2 py-1">
            ${(c / 100).toLocaleString('en-US')} tier
          </li>
        ))}
        <li className="rounded-md border border-white/10 px-2 py-1">custom $5–$10,000</li>
      </ul>

      {leader && (
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Live check — <span className="font-bold text-zinc-200">{leader.handle}</span> has{' '}
          ${(leader.bidTotalCents / 100).toLocaleString('en-US')} raised and{' '}
          {leader.uniqueClicks} verified clicks:{' '}
          <span className="font-mono">
            {SCORE_WEIGHTS.W_BID}·ln(1 + {leader.bidTotalCents / 100}) + {SCORE_WEIGHTS.W_ENG}
            ·ln(1 + {leader.uniqueClicks})
          </span>{' '}
          ={' '}
          <span className="font-mono font-bold text-hot">
            {computeScore({
              bidTotalCents: leader.bidTotalCents,
              uniqueClicks: leader.uniqueClicks,
            }).toFixed(4)}
          </span>{' '}
          — exactly their board score.
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Equal scores break to whoever&apos;s first successful bid landed earlier. Every dollar
        moves the log the same distance — doubling your total adds a constant bump, whale or
        micro.
      </p>
    </section>
  );
}
