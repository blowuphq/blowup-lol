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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Throws with a SAFETY ABORT message unless both URLs are local. REDIS_URL
 * unset is allowed (src/lib/redis.ts defaults to localhost); DATABASE_URL
 * unset is NOT (no safe default exists).
 */
export function assertLocalEnv(): void {
  const pgHost = hostnameOf(process.env.DATABASE_URL ?? '');
  if (!LOCAL_HOSTS.has(pgHost)) {
    throw new Error(
      `SAFETY ABORT: this command truncates/writes the database named by DATABASE_URL — ` +
        `it must point at a LOCAL instance (${[...LOCAL_HOSTS].join(', ')}), but its host is ` +
        `'${pgHost || '(unset/unparseable)'}'. ` +
        `Point DATABASE_URL at the local Docker Postgres or export a local value in your shell.`,
    );
  }
  const redisHost = hostnameOf(process.env.REDIS_URL ?? '');
  if (!LOCAL_HOSTS.has(redisHost) && redisHost !== '') {
    throw new Error(
      `SAFETY ABORT: this command writes/flushes keys on REDIS_URL — it must point at a ` +
        `LOCAL Redis (${[...LOCAL_HOSTS].join(', ')}), but its host is '${redisHost}'.`,
    );
  }
}
