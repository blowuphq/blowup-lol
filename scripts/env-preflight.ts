import { assertLocalDsns, hostnameOf } from '../src/lib/env-guard.js';
import { effectiveNodeEnv, envFileOrder, resolveDsns, type PreflightMode } from './env-cascade.js';

/**
 * SAFETY PREFLIGHT — the gate in front of every local command that talks to a
 * database it does not own the lifecycle of:
 *
 *   npm run dev        → --mode=next    (next dev --webpack)
 *   npm run db:push    → --mode=dotenv  (drizzle-kit, via drizzle.config.ts)
 *   npm run db:migrate → --mode=dotenv
 *   npm run db:seed    → --mode=dotenv  (scripts/seed.ts, which also guards itself)
 *
 * Runs as its own process before the real command (`preflight && command`), so
 * an abort happens before the consumer is even spawned — nothing connects.
 *
 * Deliberately imports NOTHING that opens a connection, and deliberately does
 * NOT `import 'dotenv/config'`: mutating this process's env would defeat the
 * whole point of resolving each consumer's cascade explicitly.
 *
 * Only HOSTNAMES are printed, never DSN values — this output goes in phase
 * reports.
 *
 * `next build` / `next start` are intentionally NOT gated: Vercel never reads
 * .env (it is .vercelignore'd; production env comes from the Vercel env store),
 * so gating deploys would break them while protecting nothing.
 */

function parseArgs(argv: string[]): { mode: PreflightMode; label: string } {
  let mode: PreflightMode | undefined;
  let label = '';
  for (const arg of argv) {
    if (arg === '--mode=next') mode = 'next';
    else if (arg === '--mode=dotenv') mode = 'dotenv';
    else if (arg.startsWith('--label=')) label = arg.slice('--label='.length);
    else {
      console.error(`env-preflight: unrecognized argument '${arg}'`);
      process.exit(1);
    }
  }
  if (!mode) {
    console.error('env-preflight: --mode=next or --mode=dotenv is required');
    process.exit(1);
  }
  return { mode, label };
}

const startedAt = Date.now();
const { mode, label } = parseArgs(process.argv.slice(2));
const nodeEnv = effectiveNodeEnv();
const dir = process.cwd();
const what = label ? `${label} ` : '';

let databaseUrl: string | undefined;
let redisUrl: string | undefined;
let dbSource = '(unresolved)';
let redisSource = '(unresolved)';

try {
  const resolved = resolveDsns({ mode, nodeEnv, dir });
  databaseUrl = resolved.databaseUrl.value;
  redisUrl = resolved.redisUrl.value;
  dbSource = resolved.databaseUrl.source;
  redisSource = resolved.redisUrl.source;
} catch (err) {
  // Unreadable higher-precedence .env file: refuse rather than guess.
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const searched =
  mode === 'next'
    ? `process.env > ${envFileOrder(mode, nodeEnv).join(' > ')}`
    : 'process.env > .env';

console.log(
  `env-preflight ${what}[mode=${mode}, NODE_ENV=${nodeEnv}]\n` +
    `  lookup order: ${searched}\n` +
    `  DATABASE_URL host '${hostnameOf(databaseUrl ?? '') || '(unset/unparseable)'}' ` +
    `from ${dbSource}\n` +
    `  REDIS_URL    host '${hostnameOf(redisUrl ?? '') || '(unset/unparseable)'}' ` +
    `from ${redisSource}`,
);

try {
  assertLocalDsns(databaseUrl, redisUrl);
} catch (err) {
  console.error(
    `\n${err instanceof Error ? err.message : String(err)}\n\n` +
      `  (resolved from ${dbSource} / ${redisSource} for mode=${mode}; ` +
      `refused in ${Date.now() - startedAt} ms, before ${label || 'the command'} was spawned)\n`,
  );
  process.exit(1);
}

console.log(`  OK — local. Proceeding (${Date.now() - startedAt} ms).`);
