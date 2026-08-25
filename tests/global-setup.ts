import 'dotenv/config';

/**
 * SAFETY INTERLOCK. Every integration suite in this repo TRUNCates the whole
 * schema between tests. On 2026-08-25 a plain `npm test` with production DSNs
 * sitting in .env attempted exactly that against the production database and
 * was saved only by a DNS failure. This guard makes that impossible: tests
 * may only ever run against a local development instance.
 *
 * Shell-exported variables win over .env (dotenv never clobbers), so
 *   $env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/blowup'
 *   $env:REDIS_URL    = 'redis://localhost:6379'
 * is the supported way to run the suite while .env holds prod values.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export default function globalSetup(): void {
  const pgHost = hostnameOf(process.env.DATABASE_URL ?? '');
  if (!LOCAL_HOSTS.has(pgHost)) {
    throw new Error(
      `SAFETY ABORT: integration tests TRUNCATE the database named by DATABASE_URL — ` +
        `it must point at a LOCAL instance (${[...LOCAL_HOSTS].join(', ')}), but its host is ` +
        `'${pgHost || '(unset/unparseable)'}'. ` +
        `Point DATABASE_URL at the local Docker Postgres or export a local value in your shell.`,
    );
  }
  const redisHost = hostnameOf(process.env.REDIS_URL ?? '');
  if (!LOCAL_HOSTS.has(redisHost) && redisHost !== '') {
    throw new Error(
      `SAFETY ABORT: integration tests FLUSH blowup:* keys on REDIS_URL — it must point at a ` +
        `LOCAL Redis (${[...LOCAL_HOSTS].join(', ')}), but its host is '${redisHost}'.`,
    );
  }
}
