'use client';

import Link from 'next/link';
import Image from 'next/image';

/**
 * Checkout cancel page (Phase 4.3): shown when a user cancels the Dodo
 * Payments checkout. Simple landing with a link back to the board.
 */
export default function CheckoutCancelPage() {
  return (
    <main className="relative min-h-dvh flex flex-col items-center justify-center bg-zinc-950 text-zinc-100">
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

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16 sm:py-24 text-center">
        <div className="mb-8 flex items-center justify-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-amber-400/10">
              <svg className="h-12 w-12 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
        </div>

        <h1 className="mb-2 text-[clamp(2.5rem,8vw,4rem)] font-bold uppercase leading-none tracking-tighter">
          Checkout cancelled
        </h1>

        <p className="mb-10 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
          No payment was made. Your spot is still waiting — pick it up
          whenever you&apos;re ready.
        </p>

        <Link
          href="/categories"
          className="inline-flex items-center gap-2 rounded-full bg-hot px-7 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 transition-colors hover:bg-hot/90"
        >
          Back to boards
          <span aria-hidden>→</span>
        </Link>

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