import DodoPayments from 'dodopayments';

/**
 * Dodo Payments client access. Two flavors, same pattern as the prior Stripe client:
 *
 *  - Webhook VERIFICATION uses the SDK's unwrap() helper which wraps standardwebhooks.
 *  - Session CREATION and REFUNDS need an API key. getDodo() throws if unset;
 *    tryGetDodo() returns null so routes can degrade explicitly.
 */

let cached: DodoPayments | null = null;

export function tryGetDodo(): DodoPayments | null {
  const key = process.env.DODO_API_KEY;
  if (!key) return null;

  // The SDK expects DODO_PAYMENTS_API_KEY by default, so we explicitly map our DODO_API_KEY
  // to bearerToken. We also rely on process.env.NODE_ENV or an explicit env var to control
  // the environment ('test_mode' vs 'live_mode'), as sandbox keys require 'test_mode'.
  const isProd = process.env.NODE_ENV === 'production';
  const environment = isProd ? 'live_mode' : 'test_mode';

  if (!cached) {
    cached = new DodoPayments({
      bearerToken: key,
      environment
    });
  }

  return cached;
}

export function getDodo(): DodoPayments {
  const client = tryGetDodo();
  if (!client) {
    throw new Error('DODO_API_KEY is not set — cannot call the Dodo API');
  }
  return client;
}
