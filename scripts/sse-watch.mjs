#!/usr/bin/env node
/**
 * Minimal SSE probe used to demonstrate Phase-4 DoD items headlessly
 * (stands in for a browser tab): connects to /api/events and prints every
 * frame with wall-clock timestamps.
 *
 *   node scripts/sse-watch.mjs <slug> [durationMs=15000] [lastEventId]
 *
 * Passing lastEventId simulates an EventSource reconnect (the browser sends
 * its last-seen id automatically); frames replayed because of it are tagged.
 */

const slug = process.argv[2];
const durationMs = Number(process.argv[3] ?? 15_000);
const lastEventId = process.argv[4];
const base = process.env.BASE_URL ?? 'http://localhost:3000';

if (!slug) {
  console.error('usage: node scripts/sse-watch.mjs <slug> [durationMs] [lastEventId]');
  process.exit(1);
}

const headers = {};
if (lastEventId) headers['Last-Event-ID'] = lastEventId;

const t0 = Date.now();
const stamp = () => `+${String(Date.now() - t0).padStart(6)}ms`;

console.log(
  `${stamp()} CONNECT ${base}/api/events?category=${slug}` +
    (lastEventId ? ` (reconnect, Last-Event-ID: ${lastEventId})` : ' (fresh)'),
);

const controller = new AbortController();
setTimeout(() => controller.abort(), durationMs);

try {
  const res = await fetch(`${base}/api/events?category=${encodeURIComponent(slug)}`, {
    headers,
    signal: controller.signal,
  });
  console.log(`${stamp()} HTTP ${res.status} ${res.headers.get('content-type')}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith(':')) {
        console.log(`${stamp()} keepalive`);
        continue;
      }
      const idLine = frame.split('\n').find((l) => l.startsWith('id: ')) ?? '';
      const evLine = frame.split('\n').find((l) => l.startsWith('event: ')) ?? '';
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: ')) ?? '';
      const id = idLine.slice(4);
      const type = evLine.slice(7) || 'message';
      let summary = '';
      try {
        const data = JSON.parse(dataLine.slice(6));
        if (data.type === 'rank_delta') {
          summary =
            data.entries
              .map((e) => `${e.handle} -> rank ${e.newRank} score ${e.score}`)
              .join('; ') +
            ` | activity ${data.activity.type} prev=${data.activity.previousRank} new=${data.activity.newRank}`;
        } else if (data.type === 'visitors') {
          summary = `count=${data.count}`;
        } else {
          summary = JSON.stringify(data).slice(0, 120);
        }
      } catch {
        summary = dataLine.slice(6).slice(0, 120);
      }
      console.log(`${stamp()} ${type}${id ? ` id=${id}` : ''} :: ${summary}`);
    }
  }
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    /* duration elapsed */
  } else {
    throw err;
  }
}
console.log(`${stamp()} CLOSED after ${durationMs}ms`);
