'use client';

import { useState } from 'react';
import { BID_TIERS_CENTS } from '../../config/site.js';

/**
 * Inline bid CTA (Phase 4.5, item 1), split in two pieces for the row
 * layout: BoostTrigger is the compact button inside the row's main line;
 * BoostPicker expands BELOW that line when triggered. Choosing a tier POSTs
 * to /api/checkout (architecture §4 — the only public checkout entrypoint)
 * and redirects to the returned Stripe-hosted URL. No new payment surface
 * lives here.
 *
 * Amounts come from the same BID_TIERS_CENTS the checkout validates against,
 * so the picker can never offer a tier the backend rejects. The CTA says
 * "Boost" — deliberately NOT a "$X to take #N" promise: with the
 * log-weighted score, the amount needed to pass a rival depends on their
 * clicks too, so any fixed price would be a guess.
 */

export function BoostTrigger({
  handle,
  onOpen,
}: {
  handle: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Boost ${handle}`}
      className="shrink-0 cursor-pointer rounded-lg border border-hot/50 bg-hot/15 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-hot transition-colors hover:bg-hot/25 hover:text-white sm:px-4 sm:text-sm"
    >
      Boost
    </button>
  );
}

export function BoostPicker({
  slug,
  handle,
  onClose,
}: {
  slug: string;
  handle: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function boost(amountCents: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categorySlug: slug, handle, amountCents }),
      });
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? 'checkout unavailable — try again');
      }
      window.location.assign(data.url); // Stripe-hosted checkout
    } catch (err) {
      setError(err instanceof Error ? err.message : 'checkout unavailable — try again');
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-white/5 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          Boost {handle}
        </span>
        {BID_TIERS_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            disabled={busy}
            onClick={() => void boost(cents)}
            className="cursor-pointer rounded-lg border border-hot/40 bg-hot/10 px-3 py-1.5 text-sm font-bold tabular-nums text-hot transition-colors hover:bg-hot hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            ${(cents / 100).toLocaleString('en-US')}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="ml-auto cursor-pointer rounded-lg px-2 py-1.5 text-xs uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-4 text-xs text-zinc-500">
        {busy ? 'Opening Stripe checkout…' : (error ?? ' ')}
      </p>
    </div>
  );
}
