/**
 * Site-level constants. The scoring weights here are imported by BOTH
 * lib/rank-formula.ts (execution) and, in a later phase, the public
 * /how-ranking-works page — the displayed formula must never drift from
 * the executed one (architecture §1).
 */

/** Ranking score = W_BID·ln(1 + $bid) + W_ENG·ln(1 + unique_clicks). Public. */
export const SCORE_WEIGHTS = {
  W_BID: 0.85, // ~85% weight on money (approved: 80–90 band)
  W_ENG: 0.15, // ~15% weight on engagement (approved: 10–20 band)
} as const;

/** Bid tiers shown at checkout — client sends tier ids, never dollar amounts. */
export const BID_TIERS_CENTS = [500, 2500, 10000, 50000] as const; // $5 / $25 / $100 / $500

export const CUSTOM_BID = {
  MIN_CENTS: 500, // $5 floor   — approved Q2
  MAX_CENTS: 1_000_000, // $10,000 ceiling — sanity cap (see docs/phase1-deviations.md #2)
} as const;

/** Redis key namespace (architecture §6). */
export const REDIS_KEY_PREFIX = 'blowup';
