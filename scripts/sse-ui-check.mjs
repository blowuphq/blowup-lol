/**
 * Two-tab SSE regression (Phase 4.5 DoD item 5): opens TWO real browser tabs
 * on a category board, fires one dev fake-bid, and asserts both tabs receive
 * the rank_delta over SSE and converge on the same new state — top handle
 * consistent across tabs, season total up by exactly the bid amount, no
 * console errors. Usage:
 *
 *   node scripts/sse-ui-check.mjs [slug=tech] [amountCents=50000]
 *
 * Bids on the CURRENT #2 with a $500 boost — usually flips #1, but the pass
 * condition is state convergence, not the flip (big gaps may hold).
 */
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SLUG = process.argv[2] ?? 'tech';
const AMOUNT = Number(process.argv[3] ?? 50_000);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Without these, headless Chrome freezes the first page once the second
  // opens — its EventSource handler stops running and the tab misses every
  // delta (observed: one tab converges, the other blocks even page.evaluate).
  // Visible real tabs aren't throttled like this, so disabling it models the
  // actual two-tab scenario.
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-backgrounding-occluded-pages',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

const readState = (page) =>
  page.evaluate(() => {
    const handles = [...document.querySelectorAll('section[aria-label] .truncate')];
    const total = document.body.innerText.match(/\$([\d,]+) raised this season/)?.[1] ?? null;
    return {
      top: handles[0]?.textContent ?? null,
      second: handles[1]?.textContent ?? null,
      totalCents: total ? Number(total.replaceAll(',', '')) * 100 : null,
    };
  });

const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const errors = [];

try {
  const tabs = [];
  for (const name of ['tab-A', 'tab-B']) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('section[aria-label] .truncate', { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500)); // EventSource connect + settle
    tabs.push(page);
  }

  const before = [await readState(tabs[0]), await readState(tabs[1])];
  console.log(
    `${at()} before: A top=${before[0].top} total=${before[0].totalCents} | B top=${before[1].top} total=${before[1].totalCents}`,
  );
  if (before[0].top !== before[1].top || before[0].totalCents !== before[1].totalCents) {
    throw new Error('tabs disagree BEFORE the bid — baseline inconsistent');
  }

  const target = before[0].second; // bid the #2 creator
  if (!target) throw new Error('board has fewer than two rows');
  console.log(`${at()} POST /api/dev/fake-bid: ${target} +$${AMOUNT / 100}`);
  const res = await fetch(`${BASE}/api/dev/fake-bid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, handle: target, amountCents: AMOUNT }),
  });
  if (!res.ok) throw new Error(`fake-bid failed: ${res.status} ${await res.text()}`);

  const expectedTotal = before[0].totalCents + AMOUNT;
  const deadline = Date.now() + 12_000;
  let after;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    after = [await readState(tabs[0]), await readState(tabs[1])];
    if (after[0].totalCents === expectedTotal && after[1].totalCents === expectedTotal) break;
  }

  console.log(
    `${at()} after:  A top=${after[0].top} total=${after[0].totalCents} | B top=${after[1].top} total=${after[1].totalCents}`,
  );

  const checks = [
    [`both tabs received the delta (total ${before[0].totalCents} -> ${expectedTotal})`,
      after[0].totalCents === expectedTotal && after[1].totalCents === expectedTotal],
    [`tabs agree on the new #1 (${after[0].top})`, after[0].top === after[1].top],
    ['no page errors in either tab', errors.length === 0],
  ];
  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    pass = pass && ok;
  }
  if (errors.length) console.log('console errors:', errors);
  console.log(pass ? 'VERDICT: two-tab SSE live update works after UI changes' : 'VERDICT: FAILED');
  process.exit(pass ? 0 : 1);
} finally {
  await browser.close();
}
