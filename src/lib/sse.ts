import { REDIS_KEY_PREFIX } from '../config/site.js';
import { redis } from './redis.js';
import { createRedisClient } from './redis-client.js';
import type { RedisClient } from './redis-client.js';

/**
 * Per-category SSE event hub (architecture §1 lib/sse.ts, §3 Phase B10/C).
 *
 * Transport is a Redis Stream per category (`blowup:events:{slug}`): one
 * primitive gives both LIVE fan-out (XREAD BLOCK) and Last-Event-ID replay
 * (read forward from the client's last-seen id), ordered by construction.
 * A Redis Stream — unlike an in-process ring buffer — also works across
 * serverless instances: the webhook that settles a bid may run on a
 * different instance than the one holding the viewer's SSE connection.
 * MAXLEN ~ caps replay depth so memory stays flat.
 *
 * Visitor counter (§6): `blowup:visitors:{slug}` STRING, INCR on join /
 * DECR on leave, 60s heartbeat TTL refreshed by the hub while connections
 * are alive. Cosmetic metric (§9): crash-lost DECRs self-heal when the TTL
 * lapses; reads clamp at zero.
 */

export const eventsKey = (slug: string): string => `${REDIS_KEY_PREFIX}:events:${slug}`;
export const visitorsKey = (slug: string): string => `${REDIS_KEY_PREFIX}:visitors:${slug}`;

/** Retained replay depth per category. Oldest entries trimmed lazily by XADD. */
const STREAM_MAXLEN = 500;

/**
 * XREAD BLOCK window — doubles as the keepalive/visitor-refresh cadence for
 * connected clients (well under the 60s visitor heartbeat and typical proxy
 * read timeouts).
 */
export const SSE_BLOCK_MS = 15_000;

/** §8 SSE connect cap/IP — generous fixed window; absorbs tab farms + reconnects. */
const CONNECT_WINDOW_SECONDS = 60;
export const SSE_CONNECT_LIMIT_PER_WINDOW = 60;
const connectCapKey = (ip: string) => `${REDIS_KEY_PREFIX}:rl:sse:${ip}`;

/** Payload shape published by the settlement pipelines (§3.B10 + display fields). */
export interface RankDeltaPayload {
  type: 'rank_delta';
  entries: {
    creatorId: string;
    newRank: number | null;
    score: number;
    handle: string;
    name: string | null;
    avatarUrl: string | null;
    subscriberCount: number | null;
    bidTotalCents: number;
    uniqueClicks: number;
  }[];
  activity: { type: string; previousRank: number | null; newRank: number | null; amountCents: number };
}

export interface VisitorsPayload {
  type: 'visitors';
  count: number;
}

export type BoardEventPayload = RankDeltaPayload | VisitorsPayload;

/**
 * Publish one board event AFTER the Postgres commit (ordering invariant §3).
 * Returns the stream id that becomes the SSE event id, or null on failure —
 * fail-open like safeZadd: viewers heal via reconnect replay / fresh fetch,
 * never block settlement.
 */
export async function publishBoardEvent(
  slug: string,
  payload: BoardEventPayload,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await redis.xadd(
        eventsKey(slug),
        'MAXLEN',
        '~',
        String(STREAM_MAXLEN),
        '*',
        'json',
        JSON.stringify(payload),
      );
    } catch (err) {
      console.error(`[sse] XADD failed (attempt ${attempt}/2) slug=${slug}:`, err);
    }
  }
  return null;
}

export interface StreamEvent {
  /** Redis stream id (`ms-seq`) — opaque, lexicographically ordered, valid SSE id. */
  id: string;
  payload: BoardEventPayload;
}

interface RawStreamEntry {
  0: string;
  1: unknown[];
}

/**
 * DEDICATED connection for one streaming consumer's blocking XREADs.
 *
 * Blocking commands occupy their connection for the whole block window, so
 * they must NEVER run on the shared app-wide `redis` singleton — doing that
 * serialized every publish/counter/board operation behind each 15s block
 * and delayed or dropped live fan-out. One reader per SSE connection; the
 * caller quits it on disconnect.
 */
export function openStreamReader(): RedisClient {
  return createRedisClient(process.env.REDIS_URL ?? 'redis://localhost:6379');
}

/**
 * Events strictly after `afterId`, read on `reader`. Resolves [] on block
 * timeout (caller advances its CONCRETE cursor and re-issues).
 *
 * NOTE: never pass the special id '$' from long-lived loops — XREAD
 * re-resolves '$' to the newest id AT EACH CALL, so anything published
 * between two blocked calls would be skipped. Fresh cursors come from
 * latestStreamId() instead.
 */
export async function readEventsAfter(
  slug: string,
  afterId: string,
  blockMs: number = SSE_BLOCK_MS,
  reader: RedisClient = redis,
): Promise<StreamEvent[]> {
  const res = await reader.xread('BLOCK', blockMs, 'STREAMS', eventsKey(slug), afterId);
  if (!res) return [];
  const out: StreamEvent[] = [];
  // res: [[streamKey, [[id, [field, value, field, value…]], …]], …]
  for (const stream of res as [unknown, RawStreamEntry[]][]) {
    for (const entry of stream[1] ?? []) {
      const fields = entry[1] ?? [];
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === 'json') {
          try {
            out.push({ id: entry[0], payload: JSON.parse(String(fields[i + 1])) });
          } catch {
            console.error(`[sse] undecodable event ${entry[0]} skipped`);
          }
        }
      }
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Concrete "start-of-live" cursor for FRESH connections: the newest retained
 * event id ('0-0' when the stream is empty/absent). Everything published
 * after this moment reaches the connection; nothing before it leaks through.
 */
export async function latestStreamId(slug: string): Promise<string> {
  try {
    const res = await redis.xrevrange(eventsKey(slug), '+', '-', 'COUNT', 1);
    const first = res?.[0] as RawStreamEntry | undefined;
    return first?.[0] ?? '0-0';
  } catch (err) {
    console.warn(`[sse] latestStreamId failed for '${slug}':`, err);
    return '0-0';
  }
}

// ---- Visitor counter (§6) --------------------------------------------------

export async function visitorJoined(slug: string): Promise<number> {
  try {
    const count = await redis.incr(visitorsKey(slug));
    await redis.expire(visitorsKey(slug), 60); // heartbeat TTL, refreshed below
    return Math.max(0, count);
  } catch (err) {
    console.error('[sse] visitor INCR failed:', err);
    return 0;
  }
}

export async function visitorLeft(slug: string): Promise<void> {
  try {
    await redis.decr(visitorsKey(slug));
  } catch (err) {
    console.error('[sse] visitor DECR failed:', err);
  }
}

export async function visitorCount(slug: string): Promise<number> {
  try {
    return Math.max(0, Number((await redis.get(visitorsKey(slug))) ?? 0));
  } catch {
    return 0;
  }
}

/** Heartbeat: keep the counter's 60s TTL alive while any local connection lives. */
export async function refreshVisitorHeartbeat(slug: string): Promise<void> {
  try {
    await redis.expire(visitorsKey(slug), 60);
  } catch {
    /* cosmetic metric — ignore */
  }
}

// ---- Connect cap (§8) + wire format ---------------------------------------

/** Fixed-window connect cap per IP. Returns false when over the limit. */
export async function allowSseConnect(ip: string): Promise<boolean> {
  if (!ip) return true; // no identifiable peer (local dev) — don't lock out
  try {
    const key = connectCapKey(ip);
    const hits = await redis.incr(key);
    if (hits === 1) await redis.expire(key, CONNECT_WINDOW_SECONDS);
    return hits <= SSE_CONNECT_LIMIT_PER_WINDOW;
  } catch (err) {
    console.error('[sse] connect-cap check failed (allowing):', err);
    return true; // limiter outage must not take the board down
  }
}

/** One Server-Sent-Events frame carrying a durable stream id (rank deltas). */
export function sseFrame(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Id-less frame for transient events (visitor counts). A frame WITHOUT an id
 * never touches EventSource's lastEventId — deliberate, so reconnects still
 * resume from the last real rank-delta cursor instead of a fake one.
 */
export function sseEventOnly(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Comment keepalive — holds proxies open without touching client state. */
export const SSE_KEEPALIVE = ': keepalive\n\n';
