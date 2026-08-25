import ioredis from 'ioredis';

/**
 * Interop shim for ioredis under NodeNext/TS7: ioredis is CommonJS whose
 * module.exports is the client class, but toolchains disagree on how the
 * default export presents (class vs namespace). Resolve defensively at
 * runtime and expose only the structural surface we use.
 */

/** Structural subset of the ioredis client used by Blowup. */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  /** With 'WITHSCORES' returns flat [member, score, member, score, ...] strings (ascending). */
  zrange(key: string, start: number, stop: number, ...extra: string[]): Promise<string[]>;
  /** With 'WITHSCORES' returns flat [member, score, ...] strings, highest score first. */
  zrevrange(key: string, start: number, stop: number, ...extra: string[]): Promise<string[]>;
  /**
   * Streams (Phase 4 SSE hub). Variadic forms mirror ioredis exactly —
   * argument assembly lives in src/lib/sse.ts, which is the only consumer:
   *   xadd(key, 'MAXLEN', '~', 500, '*', field1, value1, …) -> new entry id
   *   xread('BLOCK', ms, 'STREAMS', key, id)                 -> [[key, [[id, [f, v, …]], …]]] | null
   */
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>;
  xrange(key: string, ...args: (string | number)[]): Promise<unknown[]>;
  /** With ('+','-','COUNT',1) returns just the newest entry. */
  xrevrange(...args: (string | number)[]): Promise<unknown[]>;
  xread(...args: (string | number)[]): Promise<unknown[] | null>;
  /** Visitor counter + connect-cap primitives (architecture §6/§8). */
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<'OK'>;
  disconnect(): void;
}

type RedisCtor = new (
  url: string,
  opts?: { lazyConnect?: boolean; maxRetriesPerRequest?: number },
) => RedisClient;

const mod = ioredis as unknown as { default?: RedisCtor } & RedisCtor;
const ctor: RedisCtor = mod.default ?? mod;

export function createRedisClient(url: string): RedisClient {
  return new ctor(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
}
