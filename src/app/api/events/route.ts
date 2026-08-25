import type { NextRequest } from 'next/server';
import { getActiveSeason } from '../../../lib/redis.js';
import {
  SSE_BLOCK_MS,
  SSE_KEEPALIVE,
  allowSseConnect,
  latestStreamId,
  openStreamReader,
  readEventsAfter,
  refreshVisitorHeartbeat,
  sseEventOnly,
  sseFrame,
  visitorCount,
  visitorJoined,
  visitorLeft,
} from '../../../lib/sse.js';

/**
 * SSE stream: rank deltas + visitor count per category (architecture §1,
 * §3 Phase C). `GET /api/events?category=<slug>`.
 *
 * - Replay: a `Last-Event-ID` header (sent automatically by EventSource on
 *   reconnect) resumes the category's Redis Stream from that id, so a brief
 *   disconnect catches up instead of missing updates (§3C).
 * - Fresh connections pin a concrete start-of-live cursor (newest retained
 *   id); the page SSRs current state and does one fresh snapshot fetch after
 *   connect, closing any residual gap.
 * - Keepalives every SSE_BLOCK_MS carry the live visitor count.
 * - Ordering invariant honored upstream: publish happens strictly after the
 *   PG commit and the Redis ZADD.
 */

export const dynamic = 'force-dynamic';
// Serverless ceiling; EventSource reconnects transparently and the
// Last-Event-ID replay makes the hop invisible to viewers.
export const maxDuration = 300;

const CURSOR_RE = /^\d+-\d+$/;

export async function GET(request: NextRequest): Promise<Response> {
  const slug = request.nextUrl.searchParams.get('category');
  if (!slug) {
    return Response.json({ error: 'missing ?category=' }, { status: 400 });
  }

  try {
    await getActiveSeason(slug); // validates against the categories table (§1 invariant)
  } catch {
    return Response.json({ error: `unknown or inactive category: ${slug}` }, { status: 404 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (!(await allowSseConnect(ip))) {
    return Response.json(
      { error: 'too many connections' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // Replay cursor: resume from the browser's Last-Event-ID when reconnecting;
  // otherwise pin a CONCRETE start-of-live id (never '$' — see lib/sse.ts)
  // so nothing published between block windows can slip past the loop.
  const headerId = request.headers.get('last-event-id');
  let cursor = CURSOR_RE.test(headerId ?? '')
    ? (headerId as string)
    : await latestStreamId(slug);
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (text: string): boolean => {
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          return false; // client already gone
        }
      };

      // Reconnect hint + immediate self-count so a joining tab shows its own effect.
      push('retry: 3000\n\n');
      const joined = await visitorJoined(slug);
      push(sseEventOnly('visitors', { type: 'visitors', count: joined }));

      // This connection's OWN reader connection: blocking XREADs must never
      // sit on the shared app client (see openStreamReader in lib/sse.ts).
      const reader = openStreamReader();

      try {
        while (!request.signal.aborted && !cancelled) {
          let events;
          try {
            events = await readEventsAfter(slug, cursor, SSE_BLOCK_MS, reader);
          } catch (err) {
            console.warn(`[sse] read failed for '${slug}' — closing stream:`, err);
            break;
          }

          if (events.length === 0) {
            // Block timeout = keepalive beat: hold proxies open, refresh the
            // visitor heartbeat TTL, and push the current count.
            refreshVisitorHeartbeat(slug);
            const count = await visitorCount(slug);
            if (!push(SSE_KEEPALIVE)) break;
            if (!push(sseEventOnly('visitors', { type: 'visitors', count }))) break;
            continue;
          }

          for (const evt of events) {
            cursor = evt.id;
            if (!push(sseFrame(evt.id, evt.payload.type, evt.payload))) break;
          }
        }
      } finally {
        reader.quit().catch(() => reader.disconnect());
        await visitorLeft(slug);
        try {
          controller.close();
        } catch {
          /* already closed by cancel */
        }
      }
    },
    cancel() {
      // Fired on client disconnect; the loop observes this within one
      // SSE_BLOCK_MS window and runs the visitorLeft cleanup.
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable any proxy buffering in front of us (Cloudflare/Vercel).
      'X-Accel-Buffering': 'no',
    },
  });
}
