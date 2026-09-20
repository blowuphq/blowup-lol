import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../../../lib/db.js';
import { clicks, campaigns, creators, seasons } from '../../../../db/schema.js';
import crypto from 'crypto';

/**
 * Outbound click tracking (Phase 6): records a click on a creator's
 * YouTube link and redirects to the channel. Uses session-hash based
 * deduplication (no raw IP stored).
 *
 * Session hash = HMAC-SHA256(CLICK_SALT, ip || ua || daily-salt)
 * - CLICK_SALT: per-deployment constant from Vercel env
 * - daily-salt: rotates daily (based on UTC date) to limit linkability
 * - Dedup index: (campaign_id, session_hash, created_at) — one counted click
 *   per session per campaign per 24h window
 *
 * Bot filtering: rejects known bot UAs (Googlebot, bingbot, etc.) before counting.
 *
 * Route: GET /api/clicks/[creatorId]?campaign=[campaignId]&url=[encodedYouTubeUrl]
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOT_UA_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /facebot/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
  /applebot/i,
  /pinterest/i,
  /redditbot/i,
  /semrush/i,
  /ahrefs/i,
  /mj12bot/i,
  /dotbot/i,
  /crawler/i,
  /spider/i,
  /bot$/i,
];

function isBot(ua: string): boolean {
  return BOT_UA_PATTERNS.some((re) => re.test(ua));
}

function getDailySalt(): string {
  // UTC date as YYYY-MM-DD — rotates at midnight UTC
  return new Date().toISOString().slice(0, 10);
}

function computeSessionHash(ip: string, ua: string): string {
  const salt = process.env.CLICK_SALT;
  if (!salt) {
    throw new Error('CLICK_SALT is not set — cannot compute session hash');
  }
  const dailySalt = getDailySalt();
  const data = `${ip}|${ua}|${dailySalt}`;
  return crypto.createHmac('sha256', salt).update(data).digest('hex');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ creatorId: string }> }
) {
  const { creatorId } = await params;
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign');
  const targetUrl = url.searchParams.get('url');

  if (!campaignId || !targetUrl) {
    return new Response('Missing campaign or url parameter', { status: 400 });
  }

  // Validate target URL is a YouTube URL (basic check)
  let target: URL;
  try {
    target = new URL(targetUrl);
    if (!target.hostname.endsWith('youtube.com') && !target.hostname.endsWith('youtu.be')) {
      return new Response('Invalid target URL', { status: 400 });
    }
  } catch {
    return new Response('Invalid target URL', { status: 400 });
  }

  // Bot filtering: don't count bot clicks, but still redirect
  const ua = request.headers.get('user-agent') ?? '';
  if (isBot(ua)) {
    // Redirect without counting
    return Response.redirect(targetUrl, 302);
  }

  // Get client IP (from headers, respecting proxies)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';

  // Compute session hash for deduplication
  const sessionHash = computeSessionHash(ip, ua);

  // Verify campaign belongs to creator and is live
  const [campaignRow] = await db
    .select({
      id: campaigns.id,
      creatorId: campaigns.creatorId,
      seasonId: campaigns.seasonId,
      status: campaigns.status,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.creatorId, creatorId)));

  if (!campaignRow || campaignRow.status !== 'live') {
    // Still redirect but don't count
    return Response.redirect(targetUrl, 302);
  }

  // Insert click with deduplication
  // The unique index on (campaign_id, session_hash, created_at) will prevent
  // duplicate counts within the same day (dailySalt rotates at midnight UTC)
  try {
    await db.insert(clicks).values({
      creatorId: campaignRow.creatorId,
      campaignId: campaignRow.id,
      seasonId: campaignRow.seasonId,
      sessionHash,
      referrer: request.headers.get('referer') ?? null,
    });

    // Increment uniqueClicks on campaign (projection only, fail-open)
    try {
      await db.execute(
        sql`UPDATE campaigns SET unique_clicks = unique_clicks + 1, updated_at = now() WHERE id = ${campaignId}`,
      );
    } catch {
      // Projection failure — click was recorded, campaign total will reconcile
      console.error(`[clicks] failed to increment unique_clicks for campaign ${campaignId}`);
    }
  } catch (err) {
    // Likely a duplicate (unique index violation) — that's fine, still redirect
    const pgErr = err as { code?: string };
    if (pgErr.code !== '23505') {
      console.error('[clicks] insert failed:', err);
    }
  }

  return Response.redirect(targetUrl, 302);
}