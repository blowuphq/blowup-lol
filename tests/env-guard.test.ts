import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertLocalDsns, assertLocalEnv } from '../src/lib/env-guard.js';
import {
  effectiveNodeEnv,
  envFileOrder,
  resolveDsns,
  resolveEnvVar,
} from '../scripts/env-cascade.js';

/**
 * Unit tests for the SAFETY INTERLOCK shared by vitest's globalSetup and the
 * dev-* CLIs. Pure env manipulation — no database involved.
 */

const SAVED: Record<string, string | undefined> = {};

/** Shared fixtures: the real production hostnames this guard exists to refuse. */
const LOCAL_PG = 'postgres://postgres:postgres@localhost:5432/blowup';
const PROD_PG = 'postgres://u:p@ep-mute-dawn-axywisfs-pooler.c-4.us-east-2.aws.neon.tech/db';
const PROD_REDIS = 'rediss://default:pw@coherent-martin-153299.upstash.io:63799';

function setEnv(key: string, value: string | undefined): void {
  if (!(key in SAVED)) SAVED[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete SAVED[k];
  }
});

describe('assertLocalEnv safety interlock', () => {
  it('passes for every allowlisted local spelling', () => {
    // IPv6 literals must be bracketed inside URLs (parser returns '[::1]').
    const spellings = [
      ['localhost', 'localhost'],
      ['127.0.0.1', '127.0.0.1'],
      ['[::1]', '[::1]'],
      ['host.docker.internal', 'host.docker.internal'],
    ];
    for (const [label, urlHost] of spellings) {
      setEnv('DATABASE_URL', `postgres://postgres:postgres@${urlHost}:5432/blowup`);
      setEnv('REDIS_URL', `redis://${urlHost}:6379`);
      expect(() => assertLocalEnv(), label).not.toThrow();
    }
  });

  it('allows an unset REDIS_URL (redis.ts defaults to localhost) but not an unset DATABASE_URL', () => {
    setEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/blowup');
    setEnv('REDIS_URL', undefined);
    expect(() => assertLocalEnv()).not.toThrow();

    setEnv('DATABASE_URL', undefined);
    expect(() => assertLocalEnv()).toThrow(/SAFETY ABORT/);
  });

  it('rejects production-shaped URLs naming the real host', () => {
    setEnv('DATABASE_URL', 'postgres://u:p@ep-mute-dawn-axywisfs-pooler.c-4.us-east-2.aws.neon.tech/db');
    setEnv('REDIS_URL', 'rediss://default:pw@coherent-martin-153299.upstash.io:63799');
    expect(() => assertLocalEnv()).toThrow(/DATABASE_URL.*neon\.tech/s);
  });

  it('rejects spoofs that hide localhost in userinfo, query, or fragment', () => {
    setEnv('REDIS_URL', 'redis://localhost');
    const spoofs = [
      'postgres://localhost@ep-x.neon.tech/db',
      'postgres://ep-x.neon.tech/db?host=localhost',
      'postgres://ep-x.neon.tech/db#localhost',
      'postgres://localhost.evil.test/db',
      'postgres://LOCALHOST/db', // opaque scheme: no case canonicalization -> not allowlisted
      'postgres://::1:5432/db', // malformed authority (unbracketed IPv6) -> unparseable
      'not a url at all',
    ];
    for (const dsn of spoofs) {
      setEnv('DATABASE_URL', dsn);
      expect(() => assertLocalEnv(), dsn).toThrow(/SAFETY ABORT/);
    }
  });

  it('assertLocalEnv is a thin process.env wrapper over the pure assertLocalDsns', () => {
    // Same policy, one definition — the Phase 4.7 preflight calls the pure form
    // with values it resolved itself rather than what this process happens to see.
    setEnv('DATABASE_URL', PROD_PG);
    setEnv('REDIS_URL', undefined);
    expect(() => assertLocalEnv()).toThrow(/SAFETY ABORT/);
    expect(() => assertLocalDsns(process.env.DATABASE_URL, process.env.REDIS_URL)).toThrow(
      /SAFETY ABORT/,
    );
    expect(() => assertLocalDsns(LOCAL_PG, undefined)).not.toThrow();
  });
});

/**
 * Phase 4.7: the guard is only as good as the value it is handed. `next dev`
 * and `dotenv/config` resolve DATABASE_URL from DIFFERENT files, so these cases
 * pin the resolution itself — a preflight that guards the wrong value would
 * either block safe local runs or wave production through.
 */
describe('env cascade resolution (scripts/env-cascade.ts)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blowup-env-cascade-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes a dotenv file whose DATABASE_URL names its own origin in the path. */
  function writeEnvFile(name: string, marker: string): void {
    writeFileSync(join(dir, name), `DATABASE_URL=postgres://postgres:postgres@localhost:5432/${marker}\n`);
  }

  function resolveDb(
    mode: 'next' | 'dotenv',
    nodeEnv: string,
    processEnv: Record<string, string | undefined> = {},
  ) {
    return resolveEnvVar('DATABASE_URL', { mode, nodeEnv, dir, processEnv });
  }

  it('documents the exact file order per mode and NODE_ENV', () => {
    // Verbatim from node_modules/next/dist/docs/.../environment-variables.md.
    expect(envFileOrder('next', 'development')).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
    expect(envFileOrder('next', 'production')).toEqual([
      '.env.production.local',
      '.env.local',
      '.env.production',
      '.env',
    ]);
    // NODE_ENV=test drops .env.local but keeps .env.test.local.
    expect(envFileOrder('next', 'test')).toEqual(['.env.test.local', '.env.test', '.env']);
    // dotenv/config reads one file, full stop.
    expect(envFileOrder('dotenv', 'development')).toEqual(['.env']);
  });

  it('walks the full next-mode precedence ladder as files are removed', () => {
    writeEnvFile('.env.development.local', 'from_dev_local');
    writeEnvFile('.env.local', 'from_local');
    writeEnvFile('.env.development', 'from_dev');
    writeEnvFile('.env', 'from_env');

    const ladder = [
      ['.env.development.local', 'from_dev_local'],
      ['.env.local', 'from_local'],
      ['.env.development', 'from_dev'],
      ['.env', 'from_env'],
    ] as const;

    for (const [file, marker] of ladder) {
      const got = resolveDb('next', 'development');
      expect(got.source, `expected ${file} to win`).toBe(file);
      expect(got.value).toContain(marker);
      rmSync(join(dir, file)); // knock out the winner, next one down must take over
    }

    expect(resolveDb('next', 'development')).toEqual({ value: undefined, source: '(unset)' });
  });

  it('lets a shell-exported value beat every file (the documented local-run escape hatch)', () => {
    writeEnvFile('.env.development.local', 'from_dev_local');
    writeEnvFile('.env', 'from_env');
    const got = resolveDb('next', 'development', { DATABASE_URL: LOCAL_PG });
    expect(got).toEqual({ value: LOCAL_PG, source: 'process.env' });
  });

  it('ignores .env.local under NODE_ENV=test but still reads .env.test.local', () => {
    writeEnvFile('.env.local', 'from_local');
    writeEnvFile('.env', 'from_env');
    // .env.local is skipped entirely, so .env wins...
    expect(resolveDb('next', 'test').source).toBe('.env');
    // ...while .env.test.local outranks both.
    writeEnvFile('.env.test.local', 'from_test_local');
    expect(resolveDb('next', 'test').source).toBe('.env.test.local');
  });

  it('reads only .env in dotenv mode, even when higher next-mode files exist', () => {
    writeEnvFile('.env.development.local', 'from_dev_local');
    writeEnvFile('.env.local', 'from_local');
    writeEnvFile('.env', 'from_env');
    const got = resolveDb('dotenv', 'development');
    expect(got.source).toBe('.env');
    expect(got.value).toContain('from_env');
  });

  it('does NOT falsely abort when a local .env.development.local overrides a prod .env', () => {
    // The real-world shape this phase exists for: .env holds production DSNs
    // and must stay untouched, while a local override makes `npm run dev` safe.
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${PROD_PG}\nREDIS_URL=${PROD_REDIS}\n`);
    writeFileSync(
      join(dir, '.env.development.local'),
      `DATABASE_URL=${LOCAL_PG}\nREDIS_URL=redis://localhost:6379\n`,
    );

    const nextMode = resolveDsns({ mode: 'next', nodeEnv: 'development', dir, processEnv: {} });
    expect(nextMode.databaseUrl.source).toBe('.env.development.local');
    expect(() =>
      assertLocalDsns(nextMode.databaseUrl.value, nextMode.redisUrl.value),
    ).not.toThrow();

    // Same tree in dotenv mode resolves the PROD value and MUST abort — proof
    // the two modes are not interchangeable.
    const dotenvMode = resolveDsns({ mode: 'dotenv', nodeEnv: 'development', dir, processEnv: {} });
    expect(dotenvMode.databaseUrl.source).toBe('.env');
    expect(() => assertLocalDsns(dotenvMode.databaseUrl.value, dotenvMode.redisUrl.value)).toThrow(
      /SAFETY ABORT.*neon\.tech/s,
    );
  });

  it('fails closed on unset, unparseable, and exported-but-empty values', () => {
    // Nothing anywhere.
    const unset = resolveDsns({ mode: 'next', nodeEnv: 'development', dir, processEnv: {} });
    expect(unset.databaseUrl.value).toBeUndefined();
    expect(() => assertLocalDsns(unset.databaseUrl.value, unset.redisUrl.value)).toThrow(
      /SAFETY ABORT.*\(unset\/unparseable\)/s,
    );

    // Garbage in .env resolves fine but the guard rejects it.
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=not a url at all\n');
    const junk = resolveDsns({ mode: 'dotenv', nodeEnv: 'development', dir, processEnv: {} });
    expect(junk.databaseUrl.source).toBe('.env');
    expect(() => assertLocalDsns(junk.databaseUrl.value, junk.redisUrl.value)).toThrow(
      /SAFETY ABORT/,
    );

    // An exported-but-empty var shadows every file (dotenv skips keys already
    // `in` process.env), so it must resolve to '' and abort — not fall through
    // to a file value.
    writeEnvFile('.env', 'from_env');
    const empty = resolveDb('dotenv', 'development', { DATABASE_URL: '' });
    expect(empty).toEqual({ value: '', source: 'process.env' });
    expect(() => assertLocalDsns(empty.value, undefined)).toThrow(/SAFETY ABORT/);
  });

  it('refuses to guess when a higher-precedence env file exists but cannot be read', () => {
    // Skipping an unreadable HIGHER-precedence file would let a lower-precedence
    // local value win while the real resolution might have been production —
    // the one skip that is not fail-closed. A directory reproduces EISDIR
    // cross-platform (chmod is a no-op on Windows).
    mkdirSync(join(dir, '.env.development.local'));
    writeEnvFile('.env', 'from_env');
    expect(() => resolveDb('next', 'development')).toThrow(
      /SAFETY ABORT: cannot read \.env\.development\.local/,
    );
    // dotenv mode never consults that file, so it still resolves.
    expect(resolveDb('dotenv', 'development').source).toBe('.env');
  });

  it('treats an unset NODE_ENV as development (the `next dev` default)', () => {
    expect(effectiveNodeEnv({})).toBe('development');
    expect(effectiveNodeEnv({ NODE_ENV: '' })).toBe('development');
    expect(effectiveNodeEnv({ NODE_ENV: 'test' })).toBe('test');
    expect(effectiveNodeEnv({ NODE_ENV: 'production' })).toBe('production');
  });
});
