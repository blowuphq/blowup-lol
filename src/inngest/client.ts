import { Inngest } from 'inngest';

/**
 * Background-job client (architecture §5). Function definitions live in
 * ./functions and are served to Inngest via src/app/api/inngest/route.ts.
 * Scheduling needs no keys locally (Inngest Dev Server); production requires
 * INNGEST_SIGNING_KEY once an Inngest app is wired up.
 */
export const inngest = new Inngest({ id: 'blowup' });
