import Link from 'next/link';

/**
 * Checkout status banner (Phase 4.3): shown on the root `/` page when
 * Stripe redirects back after a completed or cancelled checkout. The
 * success_url and cancel_url in checkout.ts both point to `/?checkout=...`
 * — this component reads that param (passed down as a prop from the RSC)
 * and renders a one-line contextual strip. Dismiss is a Link to `/` which
 * drops the query param, keeping the component server-only (no client JS).
 */
export function CheckoutStatusBanner({ status }: { status: string | undefined }) {
  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm"
      >
        <p className="font-medium text-emerald-300">
          <span className="mr-2 font-bold">✓</span>
          Payment received — you&apos;re on the board. Watch the leaderboard update live.
        </p>
        <Link
          href="/"
          aria-label="Dismiss"
          className="shrink-0 text-xs font-bold uppercase tracking-widest text-emerald-500 transition-colors hover:text-emerald-300"
        >
          ✕
        </Link>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-3 text-sm"
      >
        <p className="font-medium text-amber-300">
          <span className="mr-2">⚠</span>
          Checkout cancelled. Your spot is still waiting — pick it up whenever you&apos;re ready.
        </p>
        <Link
          href="/"
          aria-label="Dismiss"
          className="shrink-0 text-xs font-bold uppercase tracking-widest text-amber-500 transition-colors hover:text-amber-300"
        >
          ✕
        </Link>
      </div>
    );
  }

  // Unknown or absent status — render nothing
  return null;
}
