import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '../../../lib/db.js';
import { categories } from '../../../db/schema.js';
import { loadBoard } from '../../../features/leaderboard/board.js';
import { Avatar } from '../../../components/shared/LeaderboardRow.js';
import { CategoryChips } from '../../../components/shared/CategoryChips.js';

/**
 * Category index (architecture §1 (marketing)/categories/page.tsx): every
 * ACTIVE category as a card with its current #1 as the preview. Categories
 * come from the database, never a hardcoded list (§1 invariant).
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Categories — Blowup' };

export default async function CategoriesPage() {
  const cats = await db.select().from(categories).where(eq(categories.active, true));
  const boards = await Promise.all(cats.map((c) => loadBoard(c.slug)));
  const chips = cats.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    totalCents: boards[i].rows.reduce((sum, r) => sum + r.bidTotalCents, 0),
  }));

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[28rem] w-[54rem] -translate-x-1/2 rounded-full bg-hot/20 blur-[150px]"
      />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight">
            BLOWUP<span className="text-hot">.</span>
          </Link>
          <Link
            href="/categories"
            className="inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-hot"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />
            Live boards
          </Link>
        </header>

        <section className="mt-10">
          <h1 className="text-[clamp(2.5rem,7vw,4.25rem)] font-bold uppercase leading-none tracking-tighter">
            Pick your <span className="text-hot">battle</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Weekly seasons. One board per category. Highest score wins the spotlight.
          </p>
          {/* Chip scan (Phase 4.5, item 5): activity level per category at a glance */}
          <div className="mt-5">
            <CategoryChips chips={chips} />
          </div>
        </section>

        <section className="mt-8 grid gap-3">
          {cats.map((cat, i) => {
            const leader = boards[i].rows[0];
            return (
              <Link
                key={cat.id}
                href={`/${cat.slug}`}
                className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-hot/50 hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
                      Category
                    </p>
                    <h2 className="mt-0.5 text-2xl font-bold uppercase tracking-tight transition-colors group-hover:text-hot sm:text-3xl">
                      {cat.name}
                    </h2>
                    <p className="mt-2 text-xs uppercase tracking-widest text-zinc-500">
                      Round ends{' '}
                      {new Date(boards[i].seasonEndsAt).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}{' '}
                      ·{' '}
                      <span className="tabular-nums text-zinc-400">
                        $
                        {(
                          boards[i].rows.reduce((sum, r) => sum + r.bidTotalCents, 0) / 100
                        ).toLocaleString('en-US')}{' '}
                        raised
                      </span>
                    </p>
                  </div>

                  {/* #1 preview */}
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-hot">
                      Reigning #1
                    </p>
                    {leader ? (
                      <div className="mt-2 flex items-center justify-end gap-3">
                        <div className="hidden sm:block">
                          <p className="font-bold">{leader.handle}</p>
                          <p className="text-sm tabular-nums text-zinc-400">
                            {leader.score.toFixed(4)} pts · $
                            {(leader.bidTotalCents / 100).toLocaleString('en-US')}
                          </p>
                        </div>
                        <Avatar handle={leader.handle} size="lg" />
                      </div>
                    ) : (
                      <p className="mt-2 text-sm italic text-zinc-500">Unclaimed</p>
                    )}
                  </div>
                </div>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-hot/70 via-hot/30 to-transparent opacity-60"
                />
              </Link>
            );
          })}
        </section>

        <footer className="mt-12 text-center text-xs uppercase tracking-widest text-zinc-600">
          blowup.lol
        </footer>
      </div>
    </main>
  );
}
