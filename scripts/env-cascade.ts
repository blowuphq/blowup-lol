import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

/**
 * Resolves what a consumer will ACTUALLY see for a given env var, replicating
 * the two different cascades in use in this repo. Pure and side-effect free:
 * it never mutates process.env, never opens a connection, and is the piece
 * scripts/env-preflight.ts feeds into `assertLocalDsns`.
 *
 * A guard that mis-resolves is worse than no guard — it either blocks a safe
 * local run (annoying) or waves through a production DSN (the 2026-08-25
 * near-TRUNCATE). Hence the two explicit modes:
 *
 *   'next'   — Next.js 16's documented load order, verbatim from
 *              node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
 *              ("Environment Variable Load Order"):
 *                process.env > .env.$(NODE_ENV).local
 *                            > .env.local            (skipped when NODE_ENV=test)
 *                            > .env.$(NODE_ENV)
 *                            > .env
 *   'dotenv' — `import 'dotenv/config'` as used by drizzle.config.ts and the
 *              scripts: reads ONLY .env, and never clobbers an existing
 *              process.env key.
 *
 * Deliberate fidelity gap: Next runs values through dotenv-expand ($VAR
 * interpolation) and this does not. The mismatch can only ever fail CLOSED —
 * to change the resolved *hostname*, a `$VAR` must sit inside the URL
 * authority, and an unexpanded `$VAR` there leaves a '$' in the hostname,
 * which is not on the loopback allowlist and so aborts. Expansion can turn an
 * abort into a proceed, never the reverse.
 */

export type PreflightMode = 'next' | 'dotenv';

/**
 * A bag of env vars. Deliberately looser than `NodeJS.ProcessEnv`, whose
 * next-env augmentation makes NODE_ENV a required union — this module must be
 * able to reason about an environment where NODE_ENV is absent, which is the
 * normal case (npm does not set it).
 */
export type EnvRecord = Record<string, string | undefined>;

/** Where a resolved value came from — a filename, 'process.env', or '(unset)'. */
export interface Resolution {
  value: string | undefined;
  source: string;
}

/** The dotenv files consulted, highest precedence first. */
export function envFileOrder(mode: PreflightMode, nodeEnv: string): string[] {
  if (mode === 'dotenv') return ['.env'];
  const files = [`.env.${nodeEnv}.local`];
  // Documented carve-out: .env.local is NOT read when NODE_ENV is 'test'
  // (so a developer's local overrides can't silently reshape test runs).
  // .env.test.local still is.
  if (nodeEnv !== 'test') files.push('.env.local');
  files.push(`.env.${nodeEnv}`, '.env');
  return files;
}

/**
 * Parses one dotenv file. Returns null when the file simply isn't there.
 *
 * Any OTHER read failure RETHROWS rather than skipping: a higher-precedence
 * file we cannot read might be the one holding a production DSN, and skipping
 * it would let a lower-precedence local value win — a false proceed. Absence
 * is safe to skip; unreadability is not.
 */
function readEnvFile(dir: string, name: string): Record<string, string> | null {
  try {
    return parse(readFileSync(join(dir, name)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw new Error(
      `SAFETY ABORT: cannot read ${name} while resolving env — refusing to guess what ` +
        `the value would have been (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

export interface ResolveOptions {
  mode: PreflightMode;
  nodeEnv: string;
  dir: string;
  processEnv?: EnvRecord;
  /** Reuse across vars so .env is read once per preflight. */
  cache?: Map<string, Record<string, string> | null>;
}

export function resolveEnvVar(name: string, opts: ResolveOptions): Resolution {
  const processEnv = opts.processEnv ?? process.env;

  // Presence, not truthiness: dotenv skips a key that is already `in`
  // process.env, so an exported-but-empty var really does shadow every file.
  // Resolving it to '' is correct, and '' fails the guard closed.
  if (name in processEnv) {
    return { value: processEnv[name], source: 'process.env' };
  }

  const cache = opts.cache ?? new Map();
  for (const file of envFileOrder(opts.mode, opts.nodeEnv)) {
    if (!cache.has(file)) cache.set(file, readEnvFile(opts.dir, file));
    const parsed = cache.get(file);
    if (parsed && name in parsed) return { value: parsed[name], source: file };
  }
  return { value: undefined, source: '(unset)' };
}

/** Both DSNs the guard cares about, resolved through one shared file cache. */
export function resolveDsns(opts: ResolveOptions): {
  databaseUrl: Resolution;
  redisUrl: Resolution;
} {
  const shared: ResolveOptions = { ...opts, cache: opts.cache ?? new Map() };
  return {
    databaseUrl: resolveEnvVar('DATABASE_URL', shared),
    redisUrl: resolveEnvVar('REDIS_URL', shared),
  };
}

/**
 * NODE_ENV as the GATED COMMAND will see it, not as the preflight sees it.
 * Next assigns 'development' for `next dev` and 'production' otherwise when
 * NODE_ENV is unassigned; npm does not set it, so an unset value here means
 * the `next dev` default applies.
 */
export function effectiveNodeEnv(processEnv: EnvRecord = process.env): string {
  const raw = processEnv.NODE_ENV;
  return raw && raw !== '' ? raw : 'development';
}
