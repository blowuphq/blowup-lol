import { ImageResponse } from 'next/og';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db.js';
import { campaigns, creators, seasons, categories } from '../../../../../db/schema.js';

/**
 * Shareable rank card PNG (Phase 6): generates a dark/hot-orange visual
 * language card showing a creator's rank, handle, score, and category.
 * Uses Next.js 16's built-in `next/og` ImageResponse API.
 *
 * Route: GET /api/share/[creator]/image
 * Open Graph meta tags will reference this endpoint.
 *
 * IMPORTANT: This MUST live in a file named `route.tsx` (not `image.tsx`).
 * Next.js App Router only registers files named route.ts/route.tsx as
 * Route Handlers — any other filename is treated as a page component.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function getCreatorProfile(handle: string) {
  const bare = handle.replace(/^@/, '').toLowerCase();
  const [row] = await db
    .select({
      handle: creators.handle,
      name: creators.name,
      avatarUrl: creators.avatarUrl,
      subscriberCount: creators.subscriberCount,
      categorySlug: categories.slug,
      categoryName: categories.name,
      rank: campaigns.rank,
      score: campaigns.score,
      bidTotalCents: campaigns.bidTotalCents,
      uniqueClicks: campaigns.uniqueClicks,
    })
    .from(creators)
    .innerJoin(campaigns, eq(campaigns.creatorId, creators.id))
    .innerJoin(seasons, eq(seasons.id, campaigns.seasonId))
    .innerJoin(categories, eq(categories.id, seasons.categoryId))
    .where(eq(creators.handle, `@${bare}`));

  if (!row || row.rank === null) return null;

  return {
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatarUrl,
    subscriberCount: row.subscriberCount,
    category: row.categorySlug,
    categoryName: row.categoryName,
    rank: row.rank,
    score: Number(row.score),
    bidTotalCents: Number(row.bidTotalCents),
    uniqueClicks: row.uniqueClicks,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ creator: string }> }
) {
  const { creator } = await params;
  const profile = await getCreatorProfile(creator);

  if (!profile) {
    return new Response('Not found', { status: 404 });
  }

  const ordinalSuffix = (n: number) => {
    if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  const rankText = ordinalSuffix(profile.rank);
  const scoreText = profile.score.toFixed(4);
  const bidText = `$${(profile.bidTotalCents / 100).toLocaleString('en-US')}`;
  const clicksText = profile.uniqueClicks.toLocaleString('en-US');

  // Dark/hot-orange visual language matching the app's brand.
  // NOTE: Satori (next/og) requires EVERY div with >1 child to have explicit
  // display: flex. All container divs here declare it explicitly.
  const avatarInitial = profile.handle.replace(/^@/, '').charAt(0).toUpperCase();
  const categoryLabel = `Weekly ${profile.categoryName} Leaderboard`;
  const displayName =
    profile.name && profile.name !== profile.handle ? profile.name : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: 'linear-gradient(135deg, #09090b 0%, #18181b 50%, #09090b 100%)',
          fontFamily: 'system-ui, sans-serif',
          color: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          padding: 60,
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            display: 'flex',
            background: 'linear-gradient(90deg, #ff4017 0%, #ff6b00 100%)',
          }}
        />

        {/* Header section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          {/* Logo box */}
          <div
            style={{
              width: 48,
              height: 48,
              background: 'linear-gradient(135deg, #ff4017 0%, #ff8c00 100%)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: 20,
              color: 'white',
            }}
          >
            B
          </div>
          {/* Brand text */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#ff4017', display: 'flex' }}>
              Blowup
            </div>
            <div style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'flex' }}>
              {categoryLabel}
            </div>
          </div>
        </div>

        {/* Rank badge */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 32 }}>
          <div style={{ fontSize: 120, fontWeight: 900, lineHeight: 1, color: '#ff4017', display: 'flex' }}>
            {rankText}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#71717a', marginTop: 8, display: 'flex' }}>
            Current Rank
          </div>
        </div>

        {/* Creator info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          {/* Avatar */}
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid #ff4017',
              }}
            />
          ) : (
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ff4017 0%, #ff8c00 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: 32,
                color: 'white',
              }}
            >
              {avatarInitial}
            </div>
          )}
          {/* Handle + name + category */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 36, fontWeight: 900, marginBottom: 4, display: 'flex' }}>
              {profile.handle}
            </div>
            {displayName ? (
              <div style={{ fontSize: 18, color: '#a1a1aa', fontWeight: 400, marginBottom: 4, display: 'flex' }}>
                {displayName}
              </div>
            ) : null}
            <div style={{ fontSize: 14, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex' }}>
              {profile.categoryName}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#71717a', marginBottom: 6, display: 'flex' }}>
              Score
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fafafa', display: 'flex' }}>
              {scoreText}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#71717a', marginBottom: 6, display: 'flex' }}>
              Total Bids
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#ff4017', display: 'flex' }}>
              {bidText}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#71717a', marginBottom: 6, display: 'flex' }}>
              Clicks
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fafafa', display: 'flex' }}>
              {clicksText}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'absolute', bottom: 30, left: 60, right: 60, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex' }}>
            blowup.lol
          </div>
          <div style={{ fontSize: 12, color: '#71717a', display: 'flex' }}>
            Seasons reset weekly · 85% bid / 15% engagement
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
