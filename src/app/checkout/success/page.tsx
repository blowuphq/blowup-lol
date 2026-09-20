'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

/**
 * Checkout success page (Phase 6): shown after Dodo Payments redirects back
 * with ?checkout=success&session_id={...}. Fetches the notify token from
 * /api/checkout/success and displays it with a copy-to-clipboard button.
 * This is the "claim-form success page" per the Phase 6 design — the only
 * place the blown-out tracking link is shown.
 */
export default function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const [tokenData, setTokenData] = useState<{
    handle: string;
    categorySlug: string;
    trackingUrl: string;
    token: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchToken() {
      try {
        const sp = await searchParams;
        const sessionId = sp.session_id;
        if (!sessionId) {
          setError('No session ID provided');
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/checkout/success?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (!res.ok || !data.trackingUrl) {
          throw new Error(data.error ?? 'Failed to retrieve tracking link');
        }

        setTokenData({
          handle: data.handle,
          categorySlug: data.categorySlug,
          trackingUrl: data.trackingUrl,
          token: data.token,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchToken();
  }, [searchParams]);

  async function handleCopy() {
    if (tokenData && navigator.clipboard) {
      await navigator.clipboard.writeText(tokenData.trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const fmtHandle = (handle: string) => handle.replace(/^@/, '');

  if (loading) {
    return (
      <main className="relative min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-center px-6">
          <div className="inline-flex h-12 w-12 animate-spin rounded-full border-4 border-hot/30 border-t-hot" aria-hidden />
          <p className="mt-4 text-zinc-400">Loading your tracking link…</p>
        </div>
      </main>
    );
  }

  if (error || !tokenData) {
    return (
      <main className="relative min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-center px-6">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-zinc-500">{error ?? 'Unable to retrieve your tracking link.'}</p>
          <Link
            href="/categories"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-hot px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 hover:bg-hot/90"
          >
            Browse boards
            <span aria-hidden>→</span>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh flex flex-col bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-72 left-1/2 z-0 h-[34rem] w-[62rem] -translate-x-1/2 rounded-full bg-hot/25 blur-[160px]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="inline-flex h-6 items-center gap-1 text-lg font-bold tracking-tight">
          <Image
            src="/favicon-512x512-transparent.png"
            alt=""
            width={32}
            height={32}
            className="-mr-1 h-6 w-6 object-contain"
            aria-hidden
          />
          <span className="inline-flex h-6 items-center leading-none">
            BLOWUP<span className="relative top-px ml-0.5 inline-block text-hot">.</span>
          </span>
        </Link>
      </header>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16 sm:py-24">
        {/* Success icon */}
        <div className="mb-8 flex items-center justify-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-pulse" aria-hidden />
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-emerald-400/10">
              <svg className="h-12 w-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>

        <h1 className="mb-2 text-center text-[clamp(2.5rem,8vw,4rem)] font-bold uppercase leading-none tracking-tighter">
          You&apos;re on the board
        </h1>

        <p className="mb-10 max-w-xl text-center text-base leading-relaxed text-zinc-400 sm:text-lg">
          Your bid for <span className="font-bold text-hot">{tokenData.handle}</span> has been received.
          The leaderboard will update the moment payment settles.
        </p>

        {/* Blown-out tracking link — THE key deliverable */}
        <section className="w-full max-w-xl rounded-2xl border border-hot/30 bg-gradient-to-br from-hot/10 via-transparent to-hot/5 p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-hot animate-pulse" aria-hidden />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-hot">
              Your blown-out tracking link
            </h2>
          </div>

          <p className="mb-4 text-sm text-zinc-400">
            Bookmark this link — it&apos;s the only way to see if you get knocked out of the top 3.
            <span className="font-bold text-zinc-200"> No email is sent.</span> This page won&apos;t show it again.
          </p>

          <div className="mb-4">
            <code className="block w-full overflow-x-auto rounded-lg bg-zinc-900/50 border border-white/10 px-4 py-3 text-sm font-mono text-zinc-100">
              {tokenData.trackingUrl}
            </code>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleCopy}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-hot px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 transition-colors hover:bg-hot/90"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <Link
              href={`/${tokenData.categorySlug}`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-hot/50 hover:text-hot hover:bg-white/[0.05]"
            >
              Watch the board live
              <span aria-hidden>→</span>
            </Link>
          </div>

          <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
            Token: <span className="font-mono text-zinc-400">{tokenData.token}</span>
          </p>
        </section>

        <p className="mt-8 text-center text-xs text-zinc-600">
          Seasons reset weekly · 85% bid / 15% engagement score
        </p>
      </div>

      <footer className="relative z-10 flex flex-col items-center gap-2 px-6 pb-8 text-center text-xs uppercase tracking-widest text-zinc-600">
        <span>blowup.lol</span>
        <nav className="flex items-center gap-3">
          <Link href="/privacy" className="text-zinc-600 hover:text-zinc-400">
            Privacy
          </Link>
          <span aria-hidden className="text-zinc-700">·</span>
          <Link href="/terms" className="text-zinc-600 hover:text-zinc-400">
            Terms
          </Link>
          <span aria-hidden className="text-zinc-700">·</span>
          <Link href="/refund-policy" className="text-zinc-600 hover:text-zinc-400">
            Refunds
          </Link>
        </nav>
      </footer>
    </main>
  );
}