import { SCORE_WEIGHTS } from '../config/site.js';

/**
 * THE ranking formula — single source of truth (architecture §3).
 *
 *   score = W_BID · ln(1 + bid_total_dollars) + W_ENG · ln(1 + unique_clicks)
 *
 * Publicly displayed on /how-ranking-works (later phase) from the same
 * SCORE_WEIGHTS constant, so the displayed formula cannot drift from this one.
 *
 * Properties that made log form the approved choice (Q3): deterministic,
 * monotonic, explainable ("each doubling of spend adds equal points"), and it
 * keeps the engagement share meaningful across whale-vs-micro spreads.
 */
export function computeScore(input: { bidTotalCents: number; uniqueClicks: number }): number {
  const bidDollars = input.bidTotalCents / 100;
  const raw =
    SCORE_WEIGHTS.W_BID * Math.log(1 + bidDollars) +
    SCORE_WEIGHTS.W_ENG * Math.log(1 + input.uniqueClicks);
  // Stored as numeric(14,4) — round to 4dp so PG and Redis see identical values.
  return Math.round(raw * 10_000) / 10_000;
}
