import { getDodo } from '../../../../lib/dodo.js';
import { createNotifyToken } from '../../../../lib/notify-token.js';

/**
 * Checkout success API (Phase 6): retrieves a Dodo Checkout Session
 * by its ID and returns the notify token for the "blown-out" banner.
 * Called by the success page after Dodo redirects back.
 *
 * Route: GET /api/checkout/success?session_id={CHECKOUT_SESSION_ID}
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return Response.json({ error: 'session_id is required' }, { status: 400 });
  }

  try {
    const dodo = getDodo();
    // The Dodo SDK types for CheckoutSessionStatus don't include metadata/checkout_url,
    // but the actual API response does. Use type assertion to access runtime properties.
    const session = await dodo.checkoutSessions.retrieve(sessionId) as unknown as {
      metadata?: Record<string, string>;
      checkout_url?: string;
    };

    if (!session) {
      return Response.json({ error: 'Checkout session not found' }, { status: 404 });
    }

    // Extract metadata from the checkout session (available at runtime)
    const metadata = session.metadata ?? {};
    const handle = metadata.handle;
    const seasonId = metadata.seasonId;
    const categorySlug = metadata.categorySlug;

    if (!handle || !seasonId) {
      return Response.json({ error: 'Checkout session missing required metadata' }, { status: 400 });
    }

    // Create the notify token
    const token = createNotifyToken(handle, seasonId);

    // Build the tracking URL
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const trackingUrl = `${appUrl}/profile/${encodeURIComponent(handle)}?token=${token}`;

    return Response.json({
      handle,
      seasonId,
      categorySlug,
      token,
      trackingUrl,
      checkoutUrl: session.checkout_url,
    });
  } catch (err) {
    console.error('[checkout/success] failed:', err);
    return Response.json({ error: 'Failed to retrieve checkout session' }, { status: 500 });
  }
}