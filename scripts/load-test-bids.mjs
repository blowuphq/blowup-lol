#!/usr/bin/env node
/**
 * Phase-4 load test (DoD #4): fire rapid fake bids at the DEV fake-bid
 * endpoint while leaderboard tabs are open, and watch boards stay in sync.
 *
 *   node scripts/load-test-bids.mjs [count=24] [slug=tech] [base=http://localhost:3000]
 *
 * Requires `npm run dev` started with LOCAL DSNs exported in the shell —
 * the endpoint double-guards (NODE_ENV + assertLocalEnv) and will refuse
 * anything pointing at production. Bids land across six handles so ranks
 * churn instead of appending quietly.
 */

const count = Number(process.argv[2] ?? 24);
const slug = process.argv[3] ?? 'tech';
const base = process.argv[4] ?? 'http://localhost:3000';

const HANDLES = [
  '@load-alpha',
  '@load-beta',
  '@load-gamma',
  '@load-delta',
  '@load-epsilon',
  '@load-zeta',
];
const centsFor = () => 500 * (1 + Math.floor(Math.random() * 20)); // $5–$105

let ok = 0;
let fail = 0;
const t0 = Date.now();

async function fire(i) {
  try {
    const res = await fetch(`${base}/api/dev/fake-bid`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        handle: HANDLES[i % HANDLES.length],
        amountCents: centsFor(),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    ok++;
  } catch (err) {
    fail++;
    console.error(`  bid #${i + 1} failed:`, err instanceof Error ? err.message : err);
  }
}

// Waves of 4 concurrent settlements — enough to interleave PG transactions,
// ZADDs, and SSE publishes without exhausting the local connection pool.
const WAVE = 4;
for (let i = 0; i < count; i += WAVE) {
  await Promise.all(Array.from({ length: Math.min(WAVE, count - i) }, (_, j) => fire(i + j)));
}

const ms = Date.now() - t0;
console.log(`\n${count} bids in ${ms}ms (${(count / (ms / 1000)).toFixed(1)} bids/s) — ok=${ok} failed=${fail}`);
if (fail > 0) process.exitCode = 1;
