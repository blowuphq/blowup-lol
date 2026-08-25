import { serve } from 'inngest/next';
import { inngest } from '../../../inngest/client.js';
import { leaderboardReconcile } from '../../../inngest/functions/leaderboardReconcile.js';

/**
 * Inngest serve handler (architecture §4/§5): the sync endpoint Inngest calls
 * to discover and trigger background functions. Not linked anywhere in the UI.
 *
 * Local dev: run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
 * to execute schedules without an account. Production: requires
 * INNGEST_SIGNING_KEY so unauthenticated triggers are rejected by the SDK;
 * until that key exists the 5-minute schedule simply does not fire anywhere
 * (the reconciler still runs on demand via `npm run dev:reconcile`).
 */
const handlers = serve({
  client: inngest,
  functions: [leaderboardReconcile],
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
