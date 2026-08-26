/**
 * Plain-English FAQ (Phase 4.5, item 4) — the companion to the
 * transparency-minded formula panel: same facts, zero math. Collapsed by
 * default so it supplements the formula display without competing with it.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I take #1?',
    a: 'Hit Boost on your creator and out-raise whoever sits above. Every dollar lifts their score — and because the curve is logarithmic, close boards flip fast. The new order is live on every screen within a second.',
  },
  {
    q: 'What happens when someone outbids me?',
    a: 'Your creator slides down a spot instantly — and your money stays counted for the whole season. Nothing expires mid-round. Boost again to answer back.',
  },
  {
    q: 'Does my rank ever come back?',
    a: 'Always. Boards reshuffle the second a bid settles, as many times as it takes. Wherever you stand when the round ends is what freezes into the final standings.',
  },
  {
    q: 'Is this real money?',
    a: 'Yes. Boosts run through Stripe’s secure checkout, and only settled payments move ranks — no phantom bids.',
  },
];

export function BoardFaq() {
  return (
    <section aria-label="Frequently asked questions" className="mt-8">
      <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
        Quick answers
      </h2>
      <div className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group px-5 py-3.5">
            <summary className="cursor-pointer list-none text-sm font-bold text-zinc-300 transition-colors hover:text-hot [&::-webkit-details-marker]:hidden">
              {q}
              <span
                aria-hidden
                className="float-right text-hot transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
