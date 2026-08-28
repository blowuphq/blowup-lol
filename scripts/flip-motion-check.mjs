/**
 * Phase 4.8 DoD #3 + #5 — the extraction must not have disturbed the animation.
 *
 *   node scripts/flip-motion-check.mjs [slug=tech] [handle] [amountCents]
 *
 * Phase 4.8 moved applyDelta out of LeaderboardScreen.tsx. That only touched
 * imports, but the rows it feeds are Framer Motion `layout` children, so this
 * asserts the two things a bad extraction would break:
 *
 *   DoD #3  rows FLIP rather than jump, and are NOT remounted. "No remount" is
 *           checked by stamping an expando (`__probeId`) on each row's DOM node
 *           before the bid: React preserves the node when the key is stable, and
 *           an expando is never copied onto a replacement node, so a surviving
 *           stamp is positive proof the same element was reused. "No jump" is
 *           checked by sampling getBoundingClientRect().top every animation
 *           frame across the settlement — a spring produces many INTERMEDIATE
 *           positions, a snap produces none.
 *
 *   DoD #5  under prefers-reduced-motion:reduce the flash overlay is suppressed
 *           (globals.css shortens it to 0.01s at a 2s delay). Reported honestly:
 *           that media query governs the CSS flash only. Framer Motion's layout
 *           slide is JS-driven and this codebase sets no MotionConfig
 *           reducedMotion / useReducedMotion, so the slide still runs — the
 *           comment at globals.css:30 ("without the slide/flash") overstates it.
 *           Pre-existing, unchanged by 4.8, and out of its no-styling scope.
 */
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SLUG = process.argv[2] ?? 'tech';
const HANDLE_ARG = process.argv[3];
const AMOUNT = Number(process.argv[4] ?? 150_000);

const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const errors = [];
const checks = [];
const add = (label, ok) => {
  checks.push([label, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

/** Rows as {handle, top}, read live from the DOM. */
const ROWS_FN = `() => [...document.querySelectorAll('section[aria-label] > div')]
  .map((card) => ({
    handle: card.querySelector('.truncate')?.textContent?.trim() ?? null,
    top: Math.round(card.getBoundingClientRect().top),
    probe: card.__probeId ?? null,
  }))
  .filter((r) => r.handle)`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-backgrounding-occluded-pages',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

/** Opens the board, optionally with reduced motion emulated. */
async function openBoard(reduce) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 1000 });
  if (reduce) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('section[aria-label] .truncate', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1500)); // EventSource connect + settle
  return page;
}

/** Stamps every row node and starts a per-frame position sampler. */
async function armSampler(page, ms) {
  await page.evaluate(
    (durationMs, rowsSrc) => {
      const readRows = eval(rowsSrc);
      for (const card of document.querySelectorAll('section[aria-label] > div')) {
        const h = card.querySelector('.truncate')?.textContent?.trim();
        if (h) card.__probeId = `probe:${h}`;
      }
      window.__samples = [];
      const stop = performance.now() + durationMs;
      const tick = () => {
        window.__samples.push({ t: Math.round(performance.now()), rows: readRows() });
        if (performance.now() < stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    ms,
    ROWS_FN,
  );
}

/** Distinct visual positions a row occupied, in sample order. */
function trackOf(samples, handle) {
  const tops = [];
  for (const s of samples) {
    const row = s.rows.find((r) => r.handle === handle);
    if (!row) continue;
    if (tops.length === 0 || tops[tops.length - 1] !== row.top) tops.push(row.top);
  }
  return tops;
}

try {
  // ---------- DoD #3: FLIP intact, no remount ----------
  console.log(`${at()} --- DoD #3: motion (normal motion preference) ---`);
  const page = await openBoard(false);
  const before = await page.evaluate(`(${ROWS_FN})()`);
  const incumbent = before[0];
  const candidates = before
    .slice(1)
    .filter((r) => r.handle.localeCompare(incumbent.handle) > 0);
  const bidder = HANDLE_ARG ? before.find((r) => r.handle === HANDLE_ARG) : candidates[0];
  if (!bidder) throw new Error('no later-sorting candidate on this board');
  console.log(
    `${at()} incumbent ${incumbent.handle} @top=${incumbent.top}, ` +
      `bidder ${bidder.handle} @top=${bidder.top}`,
  );

  await armSampler(page, 2500);
  const res = await fetch(`${BASE}/api/dev/fake-bid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, handle: bidder.handle, amountCents: AMOUNT }),
  });
  if (!res.ok) throw new Error(`fake-bid failed: ${res.status} ${await res.text()}`);
  console.log(`${at()} POST fake-bid ${bidder.handle} +$${AMOUNT / 100}`);
  await new Promise((r) => setTimeout(r, 3200)); // sampler window + spring settle

  const samples = await page.evaluate(() => window.__samples);
  const after = await page.evaluate(`(${ROWS_FN})()`);
  console.log(`${at()} sampled ${samples.length} frames`);

  const swapped = after[0]?.handle === bidder.handle && after[1]?.handle === incumbent.handle;
  add(`the swap happened (${after[0]?.handle} over ${incumbent.handle})`, swapped);

  for (const h of [bidder.handle, incumbent.handle]) {
    const track = trackOf(samples, h);
    const first = track[0];
    const last = track[track.length - 1];
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    // Strictly-between samples: a spring passes through them, a snap does not.
    const between = track.filter((y) => y > lo && y < hi).length;
    console.log(
      `${at()} ${h}: ${track.length} distinct tops, ${first} -> ${last}, ${between} intermediate`,
    );
    add(`${h} moved (start top != end top)`, first !== last);
    add(`${h} FLIPped through intermediate positions, did not jump (${between} > 0)`, between > 0);
  }

  const stamps = after.filter((r) => r.probe === `probe:${r.handle}`).length;
  add(
    `no row remounted — ${stamps}/${after.length} rows kept their pre-bid DOM node`,
    stamps === after.length,
  );
  add('no page errors', errors.length === 0);
  await page.close();

  // ---------- DoD #5: reduced motion ----------
  console.log(`${at()} --- DoD #5: prefers-reduced-motion: reduce ---`);
  const rPage = await openBoard(true);
  add(
    'reduce is actually emulated in this tab',
    await rPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
  );

  const rBefore = await rPage.evaluate(`(${ROWS_FN})()`);
  const rIncumbent = rBefore[0];
  const rCandidates = rBefore
    .slice(1)
    .filter((r) => r.handle.localeCompare(rIncumbent.handle) > 0);
  const rBidder = rCandidates[0] ?? rBefore[1];

  await armSampler(rPage, 2500);
  const res2 = await fetch(`${BASE}/api/dev/fake-bid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, handle: rBidder.handle, amountCents: AMOUNT }),
  });
  if (!res2.ok) throw new Error(`fake-bid failed: ${res2.status} ${await res2.text()}`);
  console.log(`${at()} POST fake-bid ${rBidder.handle} +$${AMOUNT / 100} (reduced-motion tab)`);
  await new Promise((r) => setTimeout(r, 3200));

  // The overlay is transient; read the rule the media query targets rather than
  // racing to catch the element mid-flash.
  const flashCss = await rPage.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'flash-overlay';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { duration: cs.animationDuration, delay: cs.animationDelay, name: cs.animationName };
    probe.remove();
    return out;
  });
  console.log(`${at()} .flash-overlay under reduce: ${JSON.stringify(flashCss)}`);
  add(
    `flash suppressed under reduce (duration ${flashCss.duration}, delay ${flashCss.delay})`,
    flashCss.duration === '0.01s' && flashCss.delay === '2s',
  );

  const rSamples = await rPage.evaluate(() => window.__samples);
  const rAfter = await rPage.evaluate(`(${ROWS_FN})()`);
  add(
    `board still reorders under reduce (${rAfter[0]?.handle} is #1)`,
    rAfter[0]?.handle === rBidder.handle,
  );
  const rTrack = trackOf(rSamples, rIncumbent.handle);
  const rBetween = rTrack.filter(
    (y) => y > Math.min(rTrack[0], rTrack.at(-1)) && y < Math.max(rTrack[0], rTrack.at(-1)),
  ).length;
  // Observation, not a pass/fail: documents that the JS layout slide is not
  // gated by the CSS media query. See the header note.
  console.log(
    `${at()} NOTE reduced-motion layout slide: ${rTrack.length} distinct tops, ` +
      `${rBetween} intermediate -> slide ${rBetween > 0 ? 'STILL RUNS (CSS query governs the flash only)' : 'suppressed'}`,
  );
  add('no page errors (reduced-motion tab)', errors.length === 0);

  const pass = checks.every(([, ok]) => ok);
  if (errors.length) console.log('page errors:', errors);
  console.log(pass ? 'VERDICT: motion contract intact' : 'VERDICT: FAILED');
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
}
