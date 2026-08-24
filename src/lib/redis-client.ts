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
  /** With 'WITHSCORES' returns flat [member, score, member, score, ...] strings (ascending). */
  zrange(key: string, start: number, stop: number, ...extra: string[]): Promise<string[]>;
  /** With 'WITHSCORES' returns flat [member, score, ...] strings, highest score first. */
  zrevrange(key: string, start: number, stop: number, ...extra: string[]): Promise<string[]>;
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
