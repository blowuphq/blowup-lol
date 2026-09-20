'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * "You've been blown out" banner (Phase 6): shown when a creator visits
 * their profile page with a valid notify token and their latest activity
 * shows they were knocked out of the top 3.
 *
 * The token is verified server-side before rendering this component.
 * This component receives the activity data as props and renders the banner.
 */
export function BlownOutBanner({
  handle,
  previousRank,
  newRank,
  amountCents,
  seasonId,
}: {
  handle: string;
  previousRank: number | null;
  newRank: number | null;
  amountCents: number | null;
  seasonId: string;
}) {
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/profile/${handle}?token=${new URLSearchParams(window.location.search).get('token')}`
    : '';

  async function handleCopy() {
    if (shareUrl && navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Only show if they were in top 3 and got knocked out (newRank > 3 or null)
  const wasInTop3 = previousRank !== null && previousRank <= 3;
  const isNowOut = newRank === null || newRank > 3;

  if (!wasInTop3 || !isNowOut) return null;

  const gapText = amountCents
    ? `You're $${(amountCents / 100).toLocaleString('en-US')} away from reclaiming #${previousRank}.`
    : `You've been knocked out of #${previousRank}.`;

  return (
    <div
      className="relative rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/10 via-transparent to-rose-500/5 p-5"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-rose-500/20">
          <svg
            className="w-5 h-5 text-rose-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-rose-300">You've been blown out</p>
          <p className="mt-1 text-sm text-zinc-300">{gapText}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Your tracking link (bookmark this — no email sent):
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 min-w-0 bg-zinc-900/50 border border-white/10 rounded px-3 py-2 text-xs font-mono text-zinc-300 truncate">
              {shareUrl || '/profile/@handle?token=…'}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition-colors hover:border-hot/50 hover:text-hot hover:bg-hot/10"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <Link
          href={typeof window !== 'undefined'
            ? `/${new URLSearchParams(window.location.search).get('category') || 'tech'}`
            : '/tech'}
          className="shrink-0 rounded-full border border-hot/40 bg-hot/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-hot transition-colors hover:bg-hot/20"
        >
          Back to board
        </Link>
      </div>
    </div>
  );
}