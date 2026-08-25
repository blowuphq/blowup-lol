import { afterEach, describe, expect, it } from 'vitest';
import { assertLocalEnv } from '../src/lib/env-guard.js';

/**
 * Unit tests for the SAFETY INTERLOCK shared by vitest's globalSetup and the
 * dev-* CLIs. Pure env manipulation — no database involved.
 */

const SAVED: Record<string, string | undefined> = {};

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
});
