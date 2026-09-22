import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

/**
 * Coolify's environment editor writes an **empty string** for a variable you
 * create and never fill in. That is the single most common way this app's
 * configuration goes wrong, so both blank-handling helpers are pinned here.
 *
 * `env.ts` calls `process.exit(1)` at import time on bad input, so it cannot be
 * imported in a test. These reproduce its two schema shapes exactly.
 */

const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const blankAsDefault = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

test('a blank optional variable is unset, not invalid', () => {
  const schema = blankAsUnset(z.string().min(1));
  assert.equal(schema.parse(''), undefined);
  assert.equal(schema.parse(undefined), undefined);
  assert.equal(schema.parse('value'), 'value');
});

test('a blank numeric variable falls back to its default', () => {
  // The regression: z.coerce.number() turns '' into 0, which fails min(1),
  // and .default() never runs because the value was present. A deliberately
  // blank PGPROXY_PORT must not stop the app booting.
  const schema = blankAsDefault(z.coerce.number().int().min(1).max(65535).default(5433));
  assert.equal(schema.parse(''), 5433);
  assert.equal(schema.parse(undefined), 5433);
  assert.equal(schema.parse('5544'), 5544);
});

test('a blank string variable falls back to its default rather than empty', () => {
  // DATA_DIR='' would otherwise be accepted and put the SQLite file at a
  // path relative to the working directory.
  const schema = blankAsDefault(z.string().min(1).default('/data'));
  assert.equal(schema.parse(''), '/data');
  assert.equal(schema.parse('/mnt/db'), '/mnt/db');
});

test('a blank enum falls back to its default', () => {
  const schema = blankAsDefault(z.enum(['development', 'production', 'test']).default('development'));
  assert.equal(schema.parse(''), 'development');
  assert.equal(schema.parse('production'), 'production');
});

test('a genuinely invalid value is still rejected', () => {
  const port = blankAsDefault(z.coerce.number().int().min(1).max(65535).default(5433));
  assert.ok(!port.safeParse('0').success);
  assert.ok(!port.safeParse('70000').success);
  assert.ok(!port.safeParse('nonsense').success);
});
