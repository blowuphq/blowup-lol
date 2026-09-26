# Blowup.io — Product Positioning

**Status: APPROVED PRODUCT POSITIONING — September 2026**

---

## 1. Product Definition

**Blowup is a live creator promotion and discovery marketplace.**

### Current MVP (September 2026)

YouTube-first. Creators promote their YouTube presence through transparent category rankings. Weekly seasons reset every week; the leaderboard updates in real time as settled promotions land.

### Long-Term Direction

Creator-platform agnostic. Blowup may later support creator identities/content from additional platforms, but unsupported integrations must never be presented as currently available. Do not claim Instagram, TikTok, X, Twitch, or other platforms are supported today.

---

## 2. Terminology Mapping (Old → New)

| Old (Battle/Arena) | New (Promotion/Discovery) | Notes |
|---|---|---|
| "Pick your battle" | "Pick your board" / "Choose your category" | |
| "Enter the arena" | "Join the board" / "Start promoting" | Primary CTA |
| "Weekly battlefield" | "Weekly leaderboard" / "This week's board" | |
| "Reigning #1" / "Current #1" | "Top creator" / "Leading now" / "#1 this week" | |
| "Every crown is in play" | "Creators getting attention now" / "Every spot is up for grabs" | |
| "Three moves to the top" | "Three steps to visibility" | |
| "Bid for rank" | "Bid for placement" / "Bid for visibility" | |
| "Outbid them to take the top" | "Increase your promotion to improve your placement" | |
| "Win the round" | "Lead when the week ends" / "Finish #1 this season" | |
| "Boost" (button label) | "Promote" | Primary action verb |
| "Boost {handle}" | "Promote {handle}" | |
| "Boost {amount}" | "Promote for ${amount}" | |
| "Boost again to answer back" | "Promote again to reclaim your spot" | |
| "Boards reshuffle" | "Rankings update live" | |
| "Wherever you stand when the round ends" | "Your final rank when the season closes" | |
| "Blown out" / "Knocked out" | "Moved down" / "Placement changed" | Future Phase 6 copy |
| "Reclaim #N" | "Move back up" / "Return to the Top 3" | Future Phase 6 copy |
| "Live activity" | "Live updates" / "Recent promotions" | |
| "Joined the board" | "Started promoting" / "Joined the leaderboard" | |
| "Placed a bid" | "Promoted with $X" | |
| "Moved from #N to #N" | "Moved from #N to #N" (keep — factual) | |

---

## 3. Voice & Tone Guidelines

- **Direct, not aggressive.** No combat metaphors. Creators *promote*, they don't fight.
- **Builder-friendly.** Language reflects that creators are building channels, not battling.
- **Transparent.** The mechanics (bidding, ranking, engagement) are explained plainly.
- **Momentum-oriented.** "Live," "real-time," "this week," "right now" — emphasize freshness.
- **Micro-creator accessible.** "$5 to start," "no minimum following," "weekly fresh start."

---

## 4. Key Messages (for marketing pages)

### Hero / Tagline Options
1. **Primary:** "Live creator promotion. Real-time discovery."
2. **Secondary:** "Bid for placement. Get discovered. Grow your channel."
3. **Tertiary:** "Weekly leaderboards. Transparent ranking. Pay for visibility that works."

### Creator Value (Current)
- "Promote your channel through transparent category rankings and gain visibility on Blowup."
- "Settled promotion spend contributes to your score and can improve your placement."
- "Seasons reset weekly — fresh start every week."

### Visitor Value (Current)
- "Discover creators gaining attention across live category rankings."

### Future Visitor Value (Phase 6+)
- "Click through to subscribe. Clicks from real viewers count toward rank (15% of score)."

*Measurable outbound traffic becomes a stronger value proposition once Phase 6 click tracking is repaired and shipped.*

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

### Config (Terminology Constants)
- `src/config/site.ts` — Consider adding `ACTION_VERB = 'Promote'` for consistency

### Legal Pages — NO CHANGES
- `src/app/(marketing)/privacy/page.tsx` — Keep as-is (legal accuracy)
- `src/app/(marketing)/terms/page.tsx` — Keep as-is (legal accuracy)
- `src/app/(marketing)/refund-policy/page.tsx` — Keep as-is (legal accuracy)

---

## 6. Future Feature Copy (Must Follow This Positioning)

The following Phase 6 components are NOT on the clean `main` branch and are intentionally excluded from this positioning branch. Their copy, when implemented, must follow this document:

- `src/components/shared/ActivityFeed.tsx` → should use "Live updates" / promotion language
- `src/components/shared/BlownOutBanner.tsx` → should use "Your placement changed", not combat language

### Future Phase 6 Direction (not implemented)

**Blown-out experience (placeholder for future implementation):**
> Your placement changed.
>
> Your profile moved from #3 to #4 in Tech.
>
> Your promotion is still live.
>
> Increase your promotion to move back into the Top 3.

---

## 7. Visual Identity — UNCHANGED

- Color palette (zinc-950 bg, hot accent #FF4017, emerald/cyan/amber for semantic states)
- Typography (system font, clamp() hero sizing, uppercase tracking-heavy labels)
- Framer Motion rank animations (FLIP + flash overlay)
- Heat glow background, card gradients, podium treatment
- Logo: `/favicon-512x512-transparent.png` wordmark treatment

---

## 8. Scope Boundary

**IN SCOPE:** All user-facing copy in frontend components and pages listed in §5.

**OUT OF SCOPE:**
- Backend logic, API routes, database schema, scoring formula
- Webhook handling, settlement, payment processing
- Inngest functions, Redis strategy, SSE protocol
- Legal page content (privacy, terms, refund policy)
- Environment variables, deployment config, CI/CD
- Test files (update only if assertions reference old copy)
- Documentation files other than this one
- Phase 6 components (ActivityFeed, BlownOutBanner, creator profile page, click tracking, share card, checkout pages)

---

## 9. Acceptance Criteria

1. Zero occurrences of battle/arena/crown/fight/warrior/champion/victor/defeat/conquer language in user-facing frontend copy (excluding legal pages and code comments).
2. "Promote" used on all buttons and in all tooltips/labels (not "Boost").
3. "Join the board" / "Start promoting" on all CTAs (not "Enter the arena").
4. "Pick your board" / "Choose your category" (not "Pick your battle").
5. "Current #1" / "Top creator" / "Leading now" (not "Reigning #1").
6. Visual identity 100% preserved — no CSS/design changes.
7. All existing tests pass (terminology in test assertions may need updates).
8. Build succeeds (`npm run build`).

---

## 10. Rollback Plan

If owner rejects: `git checkout main` — all changes are on `product-positioning-reset-clean` branch only.