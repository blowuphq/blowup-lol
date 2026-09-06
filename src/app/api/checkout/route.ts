import { createCheckoutSession } from '../../../features/bidding/checkout.js';
import { getDodoConfig } from '../../../lib/dodo.js';

/**
 * Public checkout entrypoint (architecture §4): validates the bid, creates a
 * Dodo-hosted Checkout Session, returns its URL. NO database writes and NO
 * rank effects happen here — settlement is webhook-driven only.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if (typeof b?.categorySlug !== 'string' || typeof b?.handle !== 'string') {
    return Response.json({ error: 'categorySlug and handle are required' }, { status: 400 });
  }
  if (b.amountCents !== undefined && typeof b.amountCents !== 'number') {
    return Response.json({ error: 'amountCents must be a number of cents' }, { status: 400 });
  }

  // Debug: log Dodo config at request time
  const config = getDodoConfig();
  console.log('[checkout] Dodo config:', config);

  try {
    const created = await createCheckoutSession({
      categorySlug: b.categorySlug,
      handle: b.handle,
      amountCents: b.amountCents as number,
      name: typeof b.name === 'string' ? b.name : undefined,
    });
    return Response.json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'checkout failed';
    // Configuration problems are ours (500); validation problems are the caller's.
    if (/DODO_API_KEY/.test(message) || /DODO_BID_PRODUCT_ID/.test(message)) {
      console.error('[checkout] misconfigured:', message);
      return Response.json({ error: 'payment system unavailable' }, { status: 500 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
