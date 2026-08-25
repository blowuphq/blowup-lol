/**
 * Pre-launch landing page (public-facing, also serves as the Stripe-review
 * surface). Deliberately minimal — the real leaderboard UI is a later phase.
 */
export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      {/* heat glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-72 left-1/2 z-0 h-[34rem] w-[62rem] -translate-x-1/2 rounded-full bg-hot/25 blur-[160px]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <span className="text-lg font-bold tracking-tight">
          BLOWUP<span className="text-hot">.</span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-hot">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />
          Launching soon
        </span>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-28 text-center">
        <h1 className="text-[clamp(4rem,14vw,10rem)] font-bold leading-none tracking-tighter">
          BLOWUP<span className="text-hot">.</span>
        </h1>
        <p className="max-w-xl text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
          A live discovery marketplace for YouTube creators. Bid for placement,
          compete for attention, blow up your channel.
        </p>
        <a
          href="/categories"
          className="group inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-hot transition-colors hover:bg-hot/20"
        >
          Watch the live boards
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </a>
      </section>

      <footer className="relative z-10 pb-8 text-center text-xs uppercase tracking-widest text-zinc-600">
        blowup.lol
      </footer>
    </main>
  );
}
