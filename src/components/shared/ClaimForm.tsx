'use client';

import { useState } from 'react';
import { BID_TIERS_CENTS, CUSTOM_BID } from '../../config/site.js';

/**
 * Self-serve creator intake form (Phase 4.3): lets any YouTube creator submit
 * their handle, pick a category and bid amount, and start a real Stripe
 * Checkout without manual intervention. Wires to the EXISTING /api/checkout
 * endpoint (architecture §4) — no new payment logic exists here.
 *
 * Mirrors the client-side validation rules the server already enforces
 * (normalizeHandle / assertBidAmount) for immediate feedback, but always
 * surfaces the server's own error message verbatim when the API rejects.
 *
 * Category context (current #1 / amount raised): provided as props by the
 * parent server component from the same loadBoard() call it already makes —
 * no extra fetch. When preselectedSlug is set (board page), the category
 * selector is locked to that board. On the root page, all categories are
 * shown as selectable pill buttons.
 */

export interface ClaimFormCategory {
  slug: string;
  name: string;
  /** Null when the board has no bids yet. */
  leader: { handle: string; bidTotalCents: number } | null;
}

const MIN_DOLLARS = CUSTOM_BID.MIN_CENTS / 100; // 5
const MAX_DOLLARS = CUSTOM_BID.MAX_CENTS / 100; // 10000

/** Client-side handle validation — matches normalizeHandle() on the server. */
function validateHandle(raw: string): string | null {
  const bare = raw.trim().replace(/^@/, '').toLowerCase();
  if (bare.length === 0) return 'Handle is required.';
  if (bare.length < 3 || bare.length > 30) return 'Handle must be 3–30 characters.';
  if (!/^[a-z0-9._-]+$/.test(bare)) {
    return 'Handle may only contain letters, numbers, dots, underscores, or dashes.';
  }
  return null;
}

/** Client-side amount validation — mirrors assertBidAmount() on the server. */
function validateDollars(raw: string): { error: string | null; cents: number } {
  const n = Number(raw.trim());
  if (!raw.trim() || isNaN(n)) return { error: 'Enter a dollar amount.', cents: 0 };
  if (!Number.isFinite(n) || n <= 0) return { error: 'Enter a valid dollar amount.', cents: 0 };
  const cents = Math.round(n * 100);
  if (cents < CUSTOM_BID.MIN_CENTS) {
    return { error: `Minimum bid is $${MIN_DOLLARS}.`, cents: 0 };
  }
  if (cents > CUSTOM_BID.MAX_CENTS) {
    return { error: `Maximum bid is $${MAX_DOLLARS.toLocaleString('en-US')}.`, cents: 0 };
  }
  return { error: null, cents };
}

export function ClaimForm({
  categories,
  preselectedSlug,
}: {
  categories: ClaimFormCategory[];
  preselectedSlug?: string;
}) {
  const defaultSlug = preselectedSlug ?? categories[0]?.slug ?? '';

  const [handle, setHandle] = useState('');
  const [categorySlug, setCategorySlug] = useState(defaultSlug);
  const [amountStr, setAmountStr] = useState('');
  const [errors, setErrors] = useState<{
    handle?: string;
    category?: string;
    amount?: string;
    submit?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  const isLocked = Boolean(preselectedSlug);
  const selectedCat = categories.find((c) => c.slug === categorySlug) ?? categories[0];
  const leader = selectedCat?.leader ?? null;

  function pickTier(cents: number) {
    setAmountStr(String(cents / 100));
    setErrors((e) => ({ ...e, amount: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation pass — gives immediate feedback without a round-trip
    const handleErr = validateHandle(handle);
    const { error: amountErr, cents: amountCents } = validateDollars(amountStr);
    const catErr = categorySlug ? undefined : 'Select a category.';

    if (handleErr || amountErr || catErr) {
      setErrors({ handle: handleErr ?? undefined, amount: amountErr ?? undefined, category: catErr });
      return;
    }

    setBusy(true);
    setErrors({});

    try {
      const bare = handle.trim().replace(/^@/, '').toLowerCase();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          categorySlug,
          handle: `@${bare}`,
          amountCents,
          name: bare, // display hint only — server accepts it as optional
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? 'Checkout unavailable — try again.');
      }

      // Stripe-hosted Checkout — same path as BoostPicker (architecture §4)
      window.location.assign(data.url);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Checkout unavailable — try again.' });
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Claim a spot on the leaderboard"
      className="rounded-2xl border border-hot/40 bg-gradient-to-br from-hot/10 via-hot/[0.04] to-transparent p-6 sm:p-8"
    >
      {/* Section label */}
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-hot">Claim a spot</p>
      <h2 className="mt-1 text-xl font-bold uppercase tracking-tighter sm:text-2xl">
        {isLocked && selectedCat
          ? `Join the ${selectedCat.name} board`
          : 'Enter the arena'}
      </h2>

      {/* Live price context */}
      <p className="mt-2 text-sm text-zinc-400">
        {leader ? (
          <>
            Current{' '}
            <span className="font-bold text-zinc-200">#1</span>
            {' has raised '}
            <span className="font-bold tabular-nums text-hot">
              ${(leader.bidTotalCents / 100).toLocaleString('en-US')}
            </span>
            {' — outbid them to take the top.'}
          </>
        ) : (
          <>
            <span className="font-bold text-zinc-200">No bids yet</span>
            {' — the first successful bid claims #1.'}
          </>
        )}
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-6 space-y-5">
        {/* Handle field */}
        <div>
          <label htmlFor="claim-handle" className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
            Your YouTube handle
          </label>
          <div className="relative mt-2">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-bold text-zinc-500"
            >
              @
            </span>
            <input
              id="claim-handle"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="yourhandle"
              value={handle.replace(/^@/, '')}
              onChange={(e) => {
                setHandle(e.target.value);
                if (errors.handle) setErrors((er) => ({ ...er, handle: undefined }));
              }}
              disabled={busy}
              aria-invalid={Boolean(errors.handle)}
              aria-describedby={errors.handle ? 'claim-handle-error' : undefined}
              className={`w-full rounded-lg border bg-zinc-900 py-2.5 pl-8 pr-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:ring-1 disabled:cursor-wait disabled:opacity-50 ${
                errors.handle
                  ? 'border-rose-500/70 focus:border-rose-500 focus:ring-rose-500/40'
                  : 'border-white/10 focus:border-hot/60 focus:ring-hot/20 hover:border-white/20'
              }`}
            />
          </div>
          {errors.handle && (
            <p id="claim-handle-error" role="alert" className="mt-1.5 text-xs text-rose-400">
              {errors.handle}
            </p>
          )}
        </div>

        {/* Category selector — locked when mounted on a board page */}
        {!isLocked && categories.length > 1 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
              Category
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Select category">
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCategorySlug(cat.slug);
                    if (errors.category) setErrors((er) => ({ ...er, category: undefined }));
                  }}
                  aria-pressed={cat.slug === categorySlug}
                  className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
                    cat.slug === categorySlug
                      ? 'border-hot/60 bg-hot/15 text-hot'
                      : 'border-white/10 text-zinc-400 hover:border-hot/40 hover:text-zinc-100'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            {errors.category && (
              <p role="alert" className="mt-1.5 text-xs text-rose-400">
                {errors.category}
              </p>
            )}
          </div>
        )}

        {/* Amount field with tier shortcuts */}
        <div>
          <label htmlFor="claim-amount" className="block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
            Bid amount
          </label>

          {/* Tier shortcuts — same BID_TIERS_CENTS the checkout validates */}
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Preset tiers">
            {BID_TIERS_CENTS.map((cents) => (
              <button
                key={cents}
                type="button"
                disabled={busy}
                onClick={() => pickTier(cents)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-bold tabular-nums transition-colors disabled:opacity-50 ${
                  amountStr === String(cents / 100)
                    ? 'border-hot/60 bg-hot/20 text-hot'
                    : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-hot/40 hover:text-zinc-100'
                }`}
              >
                ${(cents / 100).toLocaleString('en-US')}
              </button>
            ))}
          </div>

          <div className="relative mt-2">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-bold text-zinc-500"
            >
              $
            </span>
            <input
              id="claim-amount"
              type="text"
              inputMode="numeric"
              placeholder={`${MIN_DOLLARS}–${MAX_DOLLARS.toLocaleString('en-US')}`}
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                if (errors.amount) setErrors((er) => ({ ...er, amount: undefined }));
              }}
              disabled={busy}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? 'claim-amount-error' : 'claim-amount-hint'}
              className={`w-full rounded-lg border bg-zinc-900 py-2.5 pl-8 pr-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:ring-1 disabled:cursor-wait disabled:opacity-50 ${
                errors.amount
                  ? 'border-rose-500/70 focus:border-rose-500 focus:ring-rose-500/40'
                  : 'border-white/10 focus:border-hot/60 focus:ring-hot/20 hover:border-white/20'
              }`}
            />
          </div>
          {errors.amount ? (
            <p id="claim-amount-error" role="alert" className="mt-1.5 text-xs text-rose-400">
              {errors.amount}
            </p>
          ) : (
            <p id="claim-amount-hint" className="mt-1.5 text-xs text-zinc-600">
              Custom amount $5–$10,000 · enter in dollars
            </p>
          )}
        </div>

        {/* Submit error (server-level) */}
        {errors.submit && (
          <p role="alert" aria-live="polite" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {errors.submit}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={busy}
          className="group w-full cursor-pointer rounded-full bg-hot px-7 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 transition-colors hover:bg-hot/90 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? (
            <span aria-live="polite">Opening Stripe checkout…</span>
          ) : (
            <span className="inline-flex items-center gap-2">
              Claim your spot
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </span>
          )}
        </button>

        <p className="text-center text-xs text-zinc-600">
          Secure payment via Stripe · seasons reset weekly · 85% bid / 15% engagement score
        </p>
      </form>
    </section>
  );
}
