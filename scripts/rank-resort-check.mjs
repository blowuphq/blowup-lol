/**
 * Phase 4.8 DoD #2 — the overtake that actually reproduced the bug.
 *
 *   node scripts/rank-resort-check.mjs [slug=tech] [handle] [amountCents]
 *
 * scripts/sse-ui-check.mjs is NOT sufficient evidence for this fix: it asserts
 * that both tabs AGREE on the new #1, and under the old code both tabs agreed
 * on the same WRONG leader — so it passes red. This check asserts the thing
 * that was broken instead:
 *
 *   1. the bidder is on top afterwards,
 *   2. the displaced incumbent is at position 2 showing the numeral "2",
 *   3. the visible numerals are exactly 1..N with no duplicates,
 *   4. both tabs render byte-identical row state,
 *   5. no row's day-start (rank + dayDelta, read back off the badge) drifted —
 *      the spec's "one genuine trap".
 *
 * The bidder MUST be chosen so its handle sorts AFTER the incumbent's — that
 * is the only case that reproduces the old alphabetical fall-through. With no
 * handle argument the script picks such a creator itself and refuses to run if
 * the board has none.
 */
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOT_DIR ?? '.';
const SLUG = process.argv[2] ?? 'tech';
const HANDLE_ARG = process.argv[3];
const AMOUNT_ARG = process.argv[4];

/** Row state as a viewer sees it: the numeral, the handle, the day badge. */
const readRows = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll('section[aria-label] > div')];
    return cards
      .map((card) => {
        // ':scope > div > span:first-child' skips the flash overlay span, which
        // is a direct child of the card and carries no text.
        const numeral = card.querySelector(':scope > div > span:first-child')?.textContent?.trim();
        const handleEl = card.querySelector('.truncate');
        return {
          numeral: numeral ?? null,
          handle: handleEl?.textContent?.trim() ?? null,
          badge: handleEl?.nextElementSibling?.textContent?.trim() ?? null,
        };
      })
      .filter((r) => r.handle);
  });

const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const fmt = (rows) => rows.map((r) => `${r.numeral}:${r.handle}`).join(' ');
const errors = [];

/**
 * Capture a tab. `bringToFront()` is NOT optional here: Chrome stops producing
 * frames for a backgrounded tab, and CDP's captureScreenshot waits for a frame,
 * so screenshotting the non-foreground tab of a two-tab run hangs forever. The
 * --disable-*-backgrounding flags keep the tab's TIMERS alive, not its
 * compositor. shot.mjs never hit this because it drives a single page.
 * The race is a loud failure instead of another silent hang.
 */
const shoot = async (page, path) => {
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 250)); // let the newly-fronted tab paint
  await Promise.race([
    page.screenshot({ path, fullPage: false }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`screenshot timed out: ${path}`)), 20_000)),
  ]);
  console.log(`${at()} saved ${path}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Same throttling flags as sse-ui-check.mjs: without them headless Chrome
  // freezes the first tab's EventSource once the second tab opens.
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-backgrounding-occluded-pages',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

try {
  const tabs = [];
  for (const name of ['tab-A', 'tab-B']) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('section[aria-label] .truncate', { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500)); // EventSource connect + settle
    tabs.push(page);
  }

  const before = [await readRows(tabs[0]), await readRows(tabs[1])];
  console.log(`${at()} before A: ${fmt(before[0])}`);
  console.log(`${at()} before B: ${fmt(before[1])}`);
  if (JSON.stringify(before[0]) !== JSON.stringify(before[1])) {
    throw new Error('tabs disagree BEFORE the bid — baseline inconsistent');
  }
  if (before[0].length < 2) throw new Error('board has fewer than two rows');

  const incumbent = before[0][0];
  // The bug only reproduces when the bidder's handle sorts AFTER the
  // incumbent's, because that is when the old rank-tie fell through to
  // handle order and left the incumbent on top.
  const candidates = before[0].slice(1).filter((r) => r.handle.localeCompare(incumbent.handle) > 0);
  // Strongest such creator (highest on the board) — the smallest bid flips it.
  const bidder = HANDLE_ARG ? before[0].find((r) => r.handle === HANDLE_ARG) : candidates[0];

  if (!bidder) throw new Error(`handle ${HANDLE_ARG} is not on this board`);
  if (bidder.handle.localeCompare(incumbent.handle) <= 0) {
    throw new Error(
      `${bidder.handle} sorts BEFORE incumbent ${incumbent.handle} — this pairing cannot ` +
        `reproduce the bug, so a pass would prove nothing. Pick a later-sorting handle.`,
    );
  }

  await shoot(tabs[0], `${SHOTS}/4.8-before-tabA.png`);

  const amount = Number(AMOUNT_ARG ?? 150_000);
  console.log(
    `${at()} POST /api/dev/fake-bid: ${bidder.handle} +$${amount / 100} ` +
      `(incumbent ${incumbent.handle}; '${bidder.handle}' sorts after '${incumbent.handle}' ✓)`,
  );
  const res = await fetch(`${BASE}/api/dev/fake-bid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, handle: bidder.handle, amountCents: amount }),
  });
  if (!res.ok) throw new Error(`fake-bid failed: ${res.status} ${await res.text()}`);

  const deadline = Date.now() + 15_000;
  let after = before;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    after = [await readRows(tabs[0]), await readRows(tabs[1])];
    if (after[0][0]?.handle === bidder.handle && after[1][0]?.handle === bidder.handle) break;
  }

  console.log(`${at()} after  A: ${fmt(after[0])}`);
  console.log(`${at()} after  B: ${fmt(after[1])}`);

  await new Promise((r) => setTimeout(r, 1200)); // let the framer-motion spring land
  await shoot(tabs[0], `${SHOTS}/4.8-after-tabA.png`);
  await shoot(tabs[1], `${SHOTS}/4.8-after-tabB.png`);

  const numerals = after[0].map((r) => r.numeral);
  const expected = after[0].map((_, i) => String(i + 1));
  const displaced = after[0][1];

  // dayStart = rank + dayDelta is the invariant the resort must not disturb —
  // the spec's "one genuine trap": recomputing dayDelta against the FINAL rank
  // rather than carrying the stale one. Asserting a fixed direction ("down")
  // would be wrong, because whether a demoted row reads "down"/"holding"/"up"
  // depends on where it started the day; and a null dayDelta ("New today") must
  // stay null instead of becoming rank arithmetic. So compare day-STARTS.
  const dayStartOf = (r) => {
    const b = r.badge ?? '';
    if (/new today/i.test(b)) return null; // joined today: no day-start
    const up = b.match(/up (\d+) today/i);
    const down = b.match(/down (\d+) today/i);
    const delta = up ? Number(up[1]) : down ? -Number(down[1]) : /holding/i.test(b) ? 0 : undefined;
    return delta === undefined ? undefined : Number(r.numeral) + delta;
  };
  const startsBefore = new Map(before[0].map((r) => [r.handle, dayStartOf(r)]));
  const drifted = after[0]
    .filter((r) => startsBefore.has(r.handle))
    .filter((r) => dayStartOf(r) !== startsBefore.get(r.handle))
    .map((r) => `${r.handle}: ${startsBefore.get(r.handle)} -> ${dayStartOf(r)}`);
  const unparsed = after[0].filter((r) => dayStartOf(r) === undefined).map((r) => r.handle);
  const incumbentAfter = after[0].find((r) => r.handle === incumbent.handle);

  const checks = [
    [`bidder ${bidder.handle} is #1`, after[0][0]?.handle === bidder.handle],
    [
      `displaced incumbent ${incumbent.handle} sits at position 2 with numeral "2"`,
      displaced?.handle === incumbent.handle && displaced?.numeral === '2',
    ],
    [
      `numerals are exactly 1..${after[0].length} (got ${numerals.join(',')})`,
      JSON.stringify(numerals) === JSON.stringify(expected),
    ],
    ['no duplicate rank numerals', new Set(numerals).size === numerals.length],
    ['both tabs render identical rows', JSON.stringify(after[0]) === JSON.stringify(after[1])],
    [`every badge parses as a day-delta${unparsed.length ? ` (unparsed: ${unparsed})` : ''}`,
      unparsed.length === 0],
    [
      `no row's day-start drifted${drifted.length ? ` (drifted: ${drifted.join('; ')})` : ''}` +
        ` — incumbent ${incumbent.handle}: "${incumbent.badge}" -> "${incumbentAfter?.badge}"`,
      drifted.length === 0,
    ],
    ['no page errors in either tab', errors.length === 0],
  ];

  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    pass = pass && ok;
  }
  if (errors.length) console.log('console errors:', errors);
  console.log(
    pass
      ? 'VERDICT: single-entry rank_delta resorts the board; no stale rank, no duplicate numerals'
      : 'VERDICT: FAILED',
  );
  // exitCode, not process.exit(): the latter skips the finally block below and
  // orphans the Chrome process on every run.
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
}
