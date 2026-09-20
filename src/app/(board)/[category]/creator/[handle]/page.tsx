import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../../../../lib/db.js';
import { creators, campaigns, seasons, activities, categories } from '../../../../../db/schema.js';
import { verifyNotifyToken } from '../../../../../lib/notify-token.js';
import { BlownOutBanner } from '../../../../../components/shared/BlownOutBanner.js';
import { Avatar } from '../../../../../components/shared/Avatar.js';
import Link from 'next/link';
import Image from 'next/image';

/**
 * Creator profile page (Phase 6): public view of a creator's standing.
 * If visited with a valid notify token (from claim-form success page),
 * and the creator was recently knocked out of top 3, shows the
 * "blown-out" banner with their personal tracking link.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    category: string;
    handle: string;
  }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function CreatorProfilePage({ params, searchParams }: PageProps) {
  const { category: slug, handle } = await params;
  const { token } = await searchParams;

  // Fetch creator + current campaign + season
  const bareHandle = handle.replace(/^@/, '').toLowerCase();
  const normalizedHandle = `@${bareHandle}`;

  const [creatorRow] = await db
    .select({
      id: creators.id,
      handle: creators.handle,
      name: creators.name,
      avatarUrl: creators.avatarUrl,
      subscriberCount: creators.subscriberCount,
      categoryId: creators.categoryId,
    })
    .from(creators)
    .where(eq(creators.handle, normalizedHandle));

  if (!creatorRow) {
    return (
      <main className="relative min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-center px-6">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Creator not found</h1>
          <p className="mt-2 text-zinc-500">No creator with handle {normalizedHandle} exists.</p>
          <Link
            href={`/${slug}`}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-hot px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 hover:bg-hot/90"
          >
            Back to board
            <span aria-hidden>→</span>
          </Link>
        </div>
      </main>
    );
  }

  // Get active season for this category (join with categories to get season name)
  const [seasonRow] = await db
    .select({
      id: seasons.id,
      slug: categories.slug,
      name: categories.name,
      endsAt: seasons.endsAt,
      status: seasons.status,
    })
    .from(seasons)
    .innerJoin(categories, eq(categories.id, seasons.categoryId))
    .where(and(eq(categories.slug, slug), eq(seasons.status, 'active')));

  if (!seasonRow) {
    return (
      <main className="relative min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-center px-6">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Season not active</h1>
          <p className="mt-2 text-zinc-500">No active season for this category.</p>
          <Link
            href={`/${slug}`}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-hot px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-hot/25 hover:bg-hot/90"
          >
            Back to board
            <span aria-hidden>→</span>
          </Link>
        </div>
      </main>
    );
  }

  // Get creator's campaign for this season
  const [campaignRow] = await db
    .select({
      rank: campaigns.rank,
      score: campaigns.score,
      bidTotalCents: campaigns.bidTotalCents,
      uniqueClicks: campaigns.uniqueClicks,
      status: campaigns.status,
    })
    .from(campaigns)
    .where(and(eq(campaigns.creatorId, creatorRow.id), eq(campaigns.seasonId, seasonRow.id)));

  // Get recent activity for this creator in this season
  const recentActivity = await db
    .select({
      id: activities.id,
      type: activities.type,
      previousRank: activities.previousRank,
      newRank: activities.newRank,
      amountCents: activities.amountCents,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(and(eq(activities.creatorId, creatorRow.id), eq(activities.seasonId, seasonRow.id)))
    .orderBy(desc(activities.id))
    .limit(5);

  // Check if token is valid and should show blown-out banner
  let showBlownOut = false;
  let blownOutData: {
    previousRank: number | null;
    newRank: number | null;
    amountCents: number | null;
  } | null = null;

  if (token && seasonRow) {
    const valid = verifyNotifyToken(normalizedHandle, seasonRow.id, token);
    if (valid && recentActivity.length > 0) {
      const latest = recentActivity[0];
      // Show if they were in top 3 and now are out (rank > 3 or null)
      const wasInTop3 = latest.previousRank !== null && latest.previousRank <= 3;
      const isNowOut = latest.newRank === null || latest.newRank > 3;
      if (wasInTop3 && isNowOut) {
        showBlownOut = true;
        blownOutData = {
          previousRank: latest.previousRank,
          newRank: latest.newRank,
          amountCents: latest.amountCents,
        };
      }
    }
  }

  const fmtEnd = (iso: string | Date) =>
    new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  const rank = campaignRow?.rank ?? null;
  const score = campaignRow ? Number(campaignRow.score) : 0;
  const bidTotalCents = campaignRow ? Number(campaignRow.bidTotalCents) : 0;
  const uniqueClicks = campaignRow ? campaignRow.uniqueClicks : 0;

  const ordinalSuffix = (n: number) => {
    if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100 selection:bg-hot selection:text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[30rem] w-[58rem] -translate-x-1/2 rounded-full bg-hot/20 blur-[150px]"
      />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
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

        {/* Blown-out banner (Phase 6) — only renders when token is valid and creator was knocked out of top 3 */}
        {showBlownOut && blownOutData && (
          <BlownOutBanner
            handle={creatorRow.handle}
            previousRank={blownOutData.previousRank}
            newRank={blownOutData.newRank}
            amountCents={blownOutData.amountCents}
            seasonId={seasonRow.id}
          />
        )}

        {/* Profile card */}
        <section className="mt-10">
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <Avatar handle={creatorRow.handle} size="xl" />
              <div className="min-w-0 text-center sm:text-left">
                <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-3">
                  <h1 className="text-3xl font-bold uppercase tracking-tight truncate">
                    {creatorRow.handle}
                  </h1>
                  {rank && (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-hot/40 bg-hot/10 px-4 py-1.5 text-sm font-bold uppercase tracking-wider text-hot">
                      #{ordinalSuffix(rank)}
                    </span>
                  )}
                </div>
                {creatorRow.name && creatorRow.name !== creatorRow.handle && (
                  <p className="mt-1 text-lg text-zinc-400">{creatorRow.name}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-sm text-zinc-500">
                  <span>{seasonRow.name}</span>
                  <span aria-hidden>·</span>
                  <span>Round ends {fmtEnd(seasonRow.endsAt)} · UTC</span>
                  {creatorRow.subscriberCount != null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{creatorRow.subscriberCount.toLocaleString('en-US')} subscribers</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="mt-8 grid grid-cols-3 gap-4 text-center">
              <div className="rounded-lg bg-white/[0.03] p-4">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Score</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{score.toFixed(4)}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] p-4">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Total Bids</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-hot">
                  ${(bidTotalCents / 100).toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-lg bg-white/[0.03] p-4">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Clicks</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{uniqueClicks.toLocaleString('en-US')}</p>
              </div>
            </div>

            {/* Share card link */}
            <div className="mt-8 pt-6 border-t border-white/5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
                Share your rank
              </p>
              <Link
                href={`/api/share/${encodeURIComponent(creatorRow.handle)}/image`}
                className="inline-flex items-center gap-2 rounded-full border border-hot/40 bg-hot/10 px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-hot transition-colors hover:bg-hot/20"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Open rank card image
              </Link>
            </div>
          </div>
        </section>

        {/* Recent activity */}
        {recentActivity.length > 0 && (
          <section className="mt-10" aria-label="Recent activity">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-hot">Recent activity</h2>
            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] overflow-hidden">
              <ul className="divide-y divide-white/5" role="list">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="px-5 py-4 text-sm text-zinc-300">
                    <time
                      className="block text-[10px] font-mono tabular-nums text-zinc-500 mb-1"
                      dateTime={entry.createdAt.toISOString()}
                    >
                      {new Date(entry.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                        timeZone: 'UTC',
                      })}
                    </time>
                    {entry.type === 'joined_board' && (
                      <p>
                        Joined the board
                        {entry.amountCents && (
                          <>
                            {' '}with{' '}
                            <span className="font-bold text-hot">
                              ${(entry.amountCents / 100).toLocaleString('en-US')}
                            </span>
                          </>
                        )}
                        {entry.newRank && (
                          <>
                            {' '}→{' '}
                            <span className="font-bold">#{entry.newRank}</span>
                          </>
                        )}
                      </p>
                    )}
                    {entry.type === 'bid' && (
                      <p>
                        Placed a bid
                        {entry.amountCents && (
                          <>
                            {' '}
                            <span className="font-bold text-hot">
                              ${(entry.amountCents / 100).toLocaleString('en-US')}
                            </span>
                          </>
                        )}
                        {entry.newRank && (
                          <>
                            {' '}
                            <span className="text-zinc-400">(</span>
                            now <span className="font-bold">#{entry.newRank}</span>
                            <span className="text-zinc-400">)</span>
                          </>
                        )}
                      </p>
                    )}
                    {entry.type === 'rank_change' && (
                      <p>
                        Moved from
                        <span className="font-bold text-rose-400 ml-1">
                          #{entry.previousRank}
                        </span>{' '}
                        to
                        <span className="font-bold text-emerald-400 ml-1">
                          #{entry.newRank}
                        </span>
                        {entry.amountCents && (
                          <>
                            {' '}
                            <span className="text-zinc-400">(bid</span>{' '}
                            <span className="font-bold text-hot">
                              ${(entry.amountCents / 100).toLocaleString('en-US')}
                            </span>
                            <span className="text-zinc-400">)</span>
                          </>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <footer className="mt-12 flex items-center justify-between text-xs uppercase tracking-widest text-zinc-600">
          <Link href={`/${slug}`} className="transition-colors hover:text-hot">
            ← Back to {seasonRow.name}
          </Link>
          <span>blowup.lol</span>
        </footer>
      </div>
    </main>
  );
}