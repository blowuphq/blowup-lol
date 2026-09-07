import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '../../lib/db.js';
import { categories } from '../../db/schema.js';
import { loadBoard } from '../../features/leaderboard/board.js';
import { visitorCount } from '../../lib/sse.js';
import { Avatar } from '../../components/shared/Avatar.js';
import { CountUp } from '../../components/shared/CountUp.js';
import { ClaimForm } from '../../components/shared/ClaimForm.js';
import { CheckoutStatusBanner } from '../../components/shared/CheckoutStatusBanner.js';

/**
 * Root landing page (Phase 4.6): proof-of-life showcase.
 * Phase 4.3: adds the self-serve claim form (ClaimForm) and checkout status
 * banner (CheckoutStatusBanner). searchParams is accepted per Next.js 16
 * App Router convention so the root page reads ?checkout=success/cancelled
 * from Dodo Payments' redirect-back URLs.
 *
 * Phase 5.1: when COMING_SOON_MODE=true, renders a minimal launch page
 * instead of the full showcase. The proxy (proxy.ts) redirects every other
 * route here so only /, /privacy, /terms and /refund-policy are reachable.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Blowup — pick your battle' };

/* ------------------------------------------------------------------ */
/*  Coming-soon page (COMING_SOON_MODE=true)                          */
/* ------------------------------------------------------------------ */

function ComingSoonPage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      {/* heat glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-72 left-1/2 z-0 h-[34rem] w-[62rem] -translate-x-1/2 rounded-full bg-hot/25 blur-[160px]"
      />

      {/* Spacer pushes content toward vertical centre without absolute pos */}
      <div className="flex-1" />

      <section className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
        <h1 className="text-[clamp(4rem,14vw,10rem)] font-bold leading-none tracking-tighter">
          BLOWUP<span className="text-hot">.</span>
        </h1>

        <p className="text-sm font-bold uppercase tracking-[0.35em] text-hot sm:text-base">
          Launching soon
        </p>

        <p className="max-w-md text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
          A live discovery marketplace for YouTube creators.
          <br className="hidden sm:block" />
          Bid for rank. Compete for attention. Blow up your channel.
        </p>

        <a
          href="mailto:varshith@blowup.lol"
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-hot transition-colors hover:bg-hot/20"
        >
          Get in touch
        </a>
      </section>

      {/* Spacer — slightly larger below to feel grounded */}
      <div className="flex-[1.4]" />

      <footer className="relative z-10 flex flex-col items-center gap-2 px-6 pb-8 text-center text-xs uppercase tracking-widest text-zinc-600">
        <span>blowup.lol</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/privacy"
            className="text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="text-zinc-700">
            ·
          </span>
          <Link
            href="/terms"
            className="text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Terms of Service
          </Link>
          <span aria-hidden="true" className="text-zinc-700">
            ·
          </span>
          <Link
            href="/refund-policy"
            className="text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Refund Policy
          </Link>
        </nav>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Full landing page (default / COMING_SOON_MODE unset)              */
/* ------------------------------------------------------------------ */

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* ── Coming-soon gate ── */
  if (process.env.COMING_SOON_MODE === 'true') {
    return <ComingSoonPage />;
  }

  /* ── Full landing page ── */
  const sp = await searchParams;
  const checkoutStatus = typeof sp.checkout === 'string' ? sp.checkout : undefined;

  const cats = await db.select().from(categories).where(eq(categories.active, true));
  const boards = await Promise.all(cats.map((c) => loadBoard(c.slug)));
  const chips = cats.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    totalCents: boards[i].rows.reduce((sum, r) => sum + r.bidTotalCents, 0),
  }));
  const totalRaisedCents = chips.reduce((sum, c) => sum + c.totalCents, 0);
  const watchers = await Promise.all(cats.map((c) => visitorCount(c.slug)));
  const totalWatchers = watchers.reduce((sum, n) => sum + n, 0);
  const rankedCreators = boards.reduce((sum, b) => sum + b.rows.length, 0);

  // ClaimForm data: derive from the same boards already loaded — no extra fetch
  const claimCategories = cats.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    leader: boards[i].rows[0]
      ? {
          handle: boards[i].rows[0].handle,
          bidTotalCents: boards[i].rows[0].bidTotalCents,
        }
      : null,
  }));

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      {/* heat glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-72 left-1/2 z-0 h-[34rem] w-[62rem] -translate-x-1/2 rounded-full bg-hot/25 blur-[160px]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="text-lg font-bold tracking-tight">
          BLOWUP<span className="text-hot">.</span>
        </Link>
        <span className="inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-hot">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />
          {cats.length} {cats.length === 1 ? 'board' : 'boards'} live
        </span>
      </header>

      {/* Hero — wordmark treatment kept from the launch page, deliberately untouched */}
      <section className="relative z-10 flex flex-col items-center gap-5 px-6 pb-4 pt-16 text-center sm:pt-24">
        <h1 className="text-[clamp(4rem,14vw,10rem)] font-bold leading-none tracking-tighter">
          BLOWUP<span className="text-hot">.</span>
        </h1>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-hot">
          Pick your battle
        </p>
        <p className="max-w-xl text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
          A live discovery marketplace for YouTube creators. Bid for placement,
          compete for attention, blow up your channel.
        </p>
        <Link
          href="/categories"
          className="group mt-2 inline-flex items-center gap-2 rounded-full bg-hot px-7 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 transition-colors hover:bg-hot/90"
        >
          Enter the arena
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>

        {/* Live proof bar — genuinely computed above, not placeholders (§9: watcher
            counts are cosmetic-by-design; TTL self-heals lost DECRs) */}
        <section
          aria-label="Live numbers"
          className="mt-12 w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-white/10"
        >
          {/* gap-px over a light ground = hairline dividers that stay correct
              through the 4→2×2 mobile rewrap (divide-* would misplace borders) */}
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <div className="bg-zinc-950 p-4">
              <p className="text-2xl font-bold">
                $<CountUp value={Math.round(totalRaisedCents / 100)} />
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Raised this season
              </p>
            </div>
            <div className="bg-zinc-950 p-4">
              <p className="inline-flex items-center gap-2 text-2xl font-bold">
                <CountUp value={totalWatchers} />
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Watching live
              </p>
            </div>
            <div className="bg-zinc-950 p-4">
              <p className="text-2xl font-bold">{cats.length}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Boards open
              </p>
            </div>
            <div className="bg-zinc-950 p-4">
              <p className="text-2xl font-bold">{rankedCreators}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Creators ranked
              </p>
            </div>
          </div>
        </section>
      </section>

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-20 pt-16 sm:px-6">
        {/* Checkout status banner — shown on redirect back from Dodo Payments */}
        {checkoutStatus && (
          <div className="mb-8">
            <CheckoutStatusBanner status={checkoutStatus} />
          </div>
        )}

        {/* Reigning #1 preview — same rows[0] derivation /categories renders,
            so the two pages can never disagree */}
        <section aria-label="Current leaders">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-hot">
            Happening now
          </p>
          <h2 className="mt-1 text-2xl font-bold uppercase tracking-tighter sm:text-3xl">
            Every crown is in play
          </h2>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {cats.map((cat, i) => {
              const leader = boards[i].rows[0];
              return (
                <Link
                  key={cat.id}
                  href={`/${cat.slug}`}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-hot/50 hover:bg-white/[0.05]"
                >
                  <h3 className="text-xl font-bold uppercase tracking-tight transition-colors group-hover:text-hot">
                    {cat.name}
                  </h3>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.25em] text-hot">
                    Reigning #1
                  </p>
                  {leader ? (
                    <div className="mt-2 flex items-center gap-3">
                      <Avatar handle={leader.handle} size="lg" />
                      <div className="min-w-0">
                        <p className="truncate font-bold">{leader.handle}</p>
                        <p className="text-sm tabular-nums text-zinc-400">
                          {leader.score.toFixed(4)} pts · $
                          {(leader.bidTotalCents / 100).toLocaleString('en-US')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm italic text-zinc-500">
                      Unclaimed — first bid takes it
                    </p>
                  )}
                  <p className="mt-auto pt-4 text-xs uppercase tracking-widest text-zinc-500">
                    $
                    {(chips[i].totalCents / 100).toLocaleString('en-US')} raised ·{' '}
                    {new Date(boards[i].seasonEndsAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}{' '}
                    · {watchers[i]} watching
                  </p>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-hot/70 via-hot/30 to-transparent opacity-60"
                  />
                </Link>
              );
            })}
          </div>
        </section>

        {/* Claim form — joins the board by calling /api/checkout directly */}
        <section aria-label="Join the leaderboard" className="mt-14">
          <ClaimForm categories={claimCategories} />
        </section>

        {/* How it works — three moves, board-native voice */}
        <section aria-label="How it works" className="mt-20">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-hot">
            How it works
          </p>
          <h2 className="mt-1 text-2xl font-bold uppercase tracking-tighter sm:text-3xl">
            Three moves to the top
          </h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            <li>
              <p className="font-mono text-sm font-bold text-hot">01</p>
              <h3 className="mt-1 font-bold uppercase tracking-tight">Bid for rank</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                Real bids move the score. Outbid a rival and the board reorders
                the moment payment settles.
              </p>
            </li>
            <li>
              <p className="font-mono text-sm font-bold text-hot">02</p>
              <h3 className="mt-1 font-bold uppercase tracking-tight">Watch it move live</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                Every boost lands on the public board in real time — no refresh,
                no waiting. Open a second tab and watch yourself climb.
              </p>
            </li>
            <li>
              <p className="font-mono text-sm font-bold text-hot">03</p>
              <h3 className="mt-1 font-bold uppercase tracking-tight">Win the round</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                Score blends bid money and clicks — 85/15. Hold #1 when the round
                ends and the spotlight is yours.
              </p>
            </li>
          </ol>
        </section>

        {/* Closing CTA */}
        <section className="mt-20 rounded-2xl border border-hot/30 bg-gradient-to-b from-hot/10 to-transparent px-6 py-12 text-center">
          <h2 className="text-2xl font-bold uppercase tracking-tighter sm:text-3xl">
            The boards are open<span className="text-hot">.</span>
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Seasons are running right now. Pick a category and watch real money
            fight for the top spot.
          </p>
          <Link
            href="/categories"
            className="group mt-6 inline-flex items-center gap-2 rounded-full bg-hot px-7 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 transition-colors hover:bg-hot/90"
          >
            Enter the arena
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </section>

        <footer className="mt-14 flex flex-col items-center gap-2 text-center text-xs uppercase tracking-widest text-zinc-600">
          <span>blowup.lol</span>
          <nav className="flex items-center gap-3">
            <Link
              href="/privacy"
              className="text-zinc-600 transition-colors hover:text-zinc-400"
            >
              Privacy Policy
            </Link>
            <span aria-hidden="true" className="text-zinc-700">
              ·
            </span>
            <Link
              href="/terms"
              className="text-zinc-600 transition-colors hover:text-zinc-400"
            >
              Terms of Service
            </Link>
            <span aria-hidden="true" className="text-zinc-700">
              ·
            </span>
            <Link
              href="/refund-policy"
              className="text-zinc-600 transition-colors hover:text-zinc-400"
            >
              Refund Policy
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
