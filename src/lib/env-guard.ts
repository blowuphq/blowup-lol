/**
 * SAFETY INTERLOCK for anything that points at DATABASE_URL/REDIS_URL from a
 * developer machine: the vitest suites AND the dev-* CLIs. Every integration
 * suite TRUNCATEs the whole schema between tests, and the CLIs write real
 * bids/repairs — on 2026-08-25 a plain `npm test` with production DSNs
 * sitting in .env attempted exactly that against production Postgres and was
 * saved only by a DNS failure. Nothing guarded by this module may run against
 * a non-local instance; production is exercised through deployed runtime
 * instead (Vercel function logs), never from local scripts.
 *
 * The check is exact membership on the PARSED hostname (WHATWG URL parser),
 * not substring matching: userinfo/query/fragment spoofs resolve to the real
 * host, and because postgres:// is a non-special scheme there is no
 * canonicalization — only byte-exact lowercase loopback names pass (URLs wrap
 * IPv6 hosts in brackets, hence the '[::1]' entry). Every other spelling
 * (unset, unparseable, uppercase, subdomain tricks, alternate loopback forms)
 * fails CLOSED.
 *
 * Shell-exported variables win over .env (dotenv never clobbers), so
 *   $env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/blowup'
 *   $env:REDIS_URL    = 'redis://localhost:6379'
 * is the supported way to run locally while .env holds prod values.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/** Parsed hostname, or '' when unset/unparseable. Exported for display only. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** The loopback allowlist, exposed read-only for messages and tests. */
export const LOCAL_HOSTNAMES: readonly string[] = [...LOCAL_HOSTS];

/**
 * Throws with a SAFETY ABORT message unless both URLs are local. REDIS_URL
 * unset is allowed (src/lib/redis.ts defaults to localhost); DATABASE_URL
 * unset is NOT (no safe default exists).
 *
 * Pure: takes the DSNs rather than reading process.env, so callers that resolve
 * env differently from `process.env` — scripts/env-preflight.ts replicates the
 * Next.js and dotenv cascades — enforce the same policy from one definition.
 */
export function assertLocalDsns(
  databaseUrl: string | undefined,
  redisUrl: string | undefined,
): void {
  const pgHost = hostnameOf(databaseUrl ?? '');
  if (!LOCAL_HOSTS.has(pgHost)) {
    throw new Error(
      `SAFETY ABORT: this command truncates/writes the database named by DATABASE_URL — ` +
        `it must point at a LOCAL instance (${[...LOCAL_HOSTS].join(', ')}), but its host is ` +
        `'${pgHost || '(unset/unparseable)'}'. ` +
        `Point DATABASE_URL at the local Docker Postgres or export a local value in your shell.`,
    );
  }
  const redisHost = hostnameOf(redisUrl ?? '');
  if (!LOCAL_HOSTS.has(redisHost) && redisHost !== '') {
    throw new Error(
      `SAFETY ABORT: this command writes/flushes keys on REDIS_URL — it must point at a ` +
        `LOCAL Redis (${[...LOCAL_HOSTS].join(', ')}), but its host is '${redisHost}'.`,
    );
  }
}

/** `assertLocalDsns` applied to this process's own environment. */
export function assertLocalEnv(): void {
  assertLocalDsns(process.env.DATABASE_URL, process.env.REDIS_URL);
}
