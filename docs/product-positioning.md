# Blowup.io — Product Positioning Reset

**Status: DRAFT — ready for owner review**

## 1. New Positioning Statement

**Blowup is a live creator promotion and discovery marketplace for YouTube creators.**

Creators bid for placement on weekly leaderboards in category-specific boards (Tech, Gaming, Education). Higher bids yield higher visibility. Viewers discover trending creators in real time. The platform is transparent, deterministic, and built for micro-to-mid-tier creators (2K–100K subs) who want paid promotion that actually moves the needle.

---

## 2. Terminology Mapping (Old → New)

| Old (Battle/Arena) | New (Promotion/Discovery) | Notes |
|---|---|---|
| "Pick your battle" | "Pick your board" / "Choose your category" | |
| "Enter the arena" | "Join the board" / "Start promoting" | Primary CTA |
| "Weekly battlefield" | "Weekly leaderboard" / "This week's board" | |
| "Reigning #1" / "Current #1" | "Top creator" / "Leading now" / "#1 this week" | |
| "Every crown is in play" | "Every spot is up for grabs" / "Any creator can lead" | |
| "Three moves to the top" | "Three steps to visibility" | |
| "Bid for rank" | "Bid for placement" / "Bid for visibility" | |
| "Outbid them to take the top" | "Outbid to lead" / "Outbid for the top spot" | |
| "Win the round" | "Lead when the week ends" / "Finish #1 this season" | |
| "Boost" (button label) | "Promote" | Primary action verb |
| "Boost {handle}" | "Promote {handle}" | |
| "Boost {amount}" | "Promote for ${amount}" | |
| "Boost again to answer back" | "Promote again to reclaim your spot" | |
| "Boards reshuffle" | "Rankings update live" | |
| "Wherever you stand when the round ends" | "Your final rank when the season closes" | |
| "Blown out" / "Knocked out" | "Displaced" / "Moved down" | |
| "Reclaim #N" | "Reclaim the top spot" / "Move back up" | |
| "Live activity" | "Live updates" / "Recent promotions" | |
| "Joined the board" | "Started promoting" / "Joined the leaderboard" | |
| "Placed a bid" | "Promoted with $X" | |
| "Moved from #N to #N" | "Moved from #N to #N" (keep — factual) | |

---

## 3. Voice & Tone Guidelines

- **Direct, not aggressive.** No combat metaphors. Creators *promote*, they don't fight.
- **Builder-friendly.** Language reflects that creators are building channels, not battling.
- **Transparent.** The mechanics (bidding, ranking, clicks) are explained plainly — same as before.
- **Momentum-oriented.** "Live," "real-time," "this week," "right now" — emphasize freshness.
- **Micro-creator inclusive.** "$5 to start," "no minimum following," "weekly fresh start."

---

## 4. Key Messages (for marketing pages)

### Hero / Tagline Options
1. **Primary:** "Live creator promotion. Real-time discovery."
2. **Secondary:** "Bid for placement. Get discovered. Grow your channel."
3. **Tertiary:** "Weekly leaderboards. Transparent ranking. Pay for visibility that works."

### Value Props
- **For creators:** "Pay only for placement. Every dollar moves your rank. Clicks from real viewers count too (15% of score). Seasons reset weekly — fresh start every Monday."
- **For viewers:** "See who's trending right now. Discover creators investing in their growth. Click through to subscribe."

---

## 5. Files to Update (Frontend Only — No Backend Changes)

### Marketing Pages
- `src/app/(marketing)/page.tsx` — Root landing (coming-soon + full)
- `src/app/(marketing)/categories/page.tsx` — Category index

### Board Pages
- `src/app/(board)/[category]/LeaderboardScreen.tsx` — Live board

### Shared Components
- `src/components/shared/ClaimForm.tsx` — Creator intake form
- `src/components/shared/BoardFaq.tsx` — FAQ
- `src/components/shared/BidButton.tsx` — Inline promote button + picker
- `src/components/shared/LeaderboardRow.tsx` — Row rendering + delta badges
- `src/components/shared/ScoreFormula.tsx` — Formula panel (keep technical accuracy)
- `src/components/shared/ActivityFeed.tsx` — Activity ticker
- `src/components/shared/BlownOutBanner.tsx` — Displacement notification

### Config (Terminology Constants)
- `src/config/site.ts` — Consider adding `ACTION_VERB = 'Promote'` for consistency

### Legal Pages — NO CHANGES
- `src/app/(marketing)/privacy/page.tsx` — Keep as-is (legal accuracy)
- `src/app/(marketing)/terms/page.tsx` — Keep as-is (legal accuracy)
- `src/app/(marketing)/refund-policy/page.tsx` — Keep as-is (legal accuracy)

---

## 6. Visual Identity — UNCHANGED

- Color palette (zinc-950 bg, hot accent #FF4017, emerald/cyan/amber for semantic states)
- Typography (system font, clamp() hero sizing, uppercase tracking-heavy labels)
- Framer Motion rank animations (FLIP + flash overlay)
- Heat glow background, card gradients, podium treatment
- Logo: `/favicon-512x512-transparent.png` wordmark treatment

---

## 7. Scope Boundary

**IN SCOPE:** All user-facing copy in frontend components and pages listed above.

**OUT OF SCOPE:**
- Backend logic, API routes, database schema, scoring formula
- Webhook handling, settlement, payment processing
- Inngest functions, Redis strategy, SSE protocol
- Legal page content (privacy, terms, refund policy)
- Environment variables, deployment config, CI/CD
- Test files (update only if assertions reference old copy)
- Documentation files other than this one and progress.md

---

## 8. Acceptance Criteria

1. Zero occurrences of battle/arena/crown/fight/warrior/champion/victor/defeat/conquer language in user-facing frontend copy (excluding legal pages and code comments).
2. "Boost" → "Promote" on all buttons and in all tooltips/labels.
3. "Enter the arena" → "Join the board" / "Start promoting" on all CTAs.
4. "Pick your battle" → "Pick your board" / "Choose your category".
5. "Reigning #1" → "Top creator" / "Leading now" / "#1 this week".
6. "Blown out" → "Displaced" in BlownOutBanner.
7. Visual identity 100% preserved — no CSS/design changes.
8. All existing tests pass (terminology in test assertions may need updates).
9. Build succeeds (`npm run build`).

---

## 9. Rollback Plan

If owner rejects: `git checkout main` — all changes are on `product-positioning-reset` branch only.