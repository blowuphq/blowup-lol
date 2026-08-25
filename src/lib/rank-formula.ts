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

/**
 * R3 fix (docs/phase2-race-risks.md): Redis ZSETs break ties on float64 score,
 * PG breaks them by (first succeeded bid ASC, campaign id ASC) — two creators
 * with byte-equal rounded scores could display in different relative order
 * depending on which store served the read. We therefore project a
 * TIEBREAK-ADJUSTED score into the ZSET:
 *
 *   zsetScore = score − TIEBREAK_EPSILON · firstBidOrdinal
 *
 * where firstBidOrdinal is the campaign's position in the season-wide
 * `ORDER BY first_succeeded_bid ASC NULLS LAST, campaign_id ASC` ordering
 * (ROW_NUMBER over exactly the PG tiebreak keys). Equal raw scores then order
 * identically in ZREVRANGE and in PG; DISTINCT raw scores are untouched
 * because two different numeric(14,4) scores differ by ≥ 1e-4 while the whole
 * adjustment spans ≤ 1e-11 · N (≤ 1e-5 even at a million campaigns).
 *
 * The epsilon is bounded below by float64 resolution: at score magnitude ~10
 * one ulp ≈ 1.8e-15, and 1e-11 steps remain cleanly representable. Raw
 * timestamps are NOT usable as the ordinal (µs-scale spreads would need
 * ε ≈ 1e-16, below that ulp).
 *
 * The ordinal is stable for existing campaigns: bids are append-only, so a
 * new campaign always enters at the END of the first_bid ordering and never
 * shifts anyone already ranked — unlike `rank` itself, which reshuffles on
 * every competing bid and would make folded scores go stale immediately.
 */
export const TIEBREAK_EPSILON = 1e-11;

/** Fold the PG tiebreak into a ZSET score. `firstBidOrdinal` starts at 1. */
export function toZsetScore(score: number, firstBidOrdinal: number): number {
  return score - TIEBREAK_EPSILON * firstBidOrdinal;
}
