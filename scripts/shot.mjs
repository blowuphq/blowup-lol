/**
 * Screenshot driver for board UI verification (puppeteer-core + a system
 * Chrome/Edge — no browser download). Usage:
 *
 *   node scripts/shot.mjs <path> <outFile> [waitForSelector] [fullPage=1] [clickSelector] [W] [H]
 *
 * Set SHOT_CHROME to override the browser binary (defaults to this
 * machine's installed Chrome).
 */
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const [rawPath = 'tech', out = 'shot.png', waitFor = 'h1', fullPage = '1', clickSel, rawW, rawH] =
  process.argv.slice(2);
const W = Number(rawW) || 1280;
const H = Number(rawH) || 900;
// git-bash mangles leading-slash args into Windows paths; accept bare slugs.
const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  // SSE holds a connection open forever, so networkidle never settles —
  // 'load' + explicit content wait is the right settle strategy here.
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 60_000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30_000 });
  if (clickSel) await page.click(clickSel);
  await new Promise((r) => setTimeout(r, 1800)); // let framer-motion springs settle
  await page.screenshot({ path: out, fullPage: fullPage === '1' });
  console.log(`saved ${out} (${path})`);
} finally {
  await browser.close();
}
