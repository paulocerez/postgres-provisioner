import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envKeySchema, linkProjectSchema } from '@app/shared';

/**
 * The variable name is validated here rather than left to Vercel, because the
 * failure mode of not doing so is a typo written into someone's production
 * project and only noticed when their deploy cannot find `DATABASE_UR`.
 */

function keyError(raw: string): string {
  const parsed = envKeySchema.safeParse(raw);
  assert.ok(!parsed.success, `expected ${JSON.stringify(raw)} to be rejected`);
  return parsed.error.issues[0]?.message ?? '';
}

test('accepts the shapes a runtime will actually expose', () => {
  assert.equal(envKeySchema.parse('DATABASE_URL'), 'DATABASE_URL');
  assert.equal(envKeySchema.parse('_PRIVATE'), '_PRIVATE');
  assert.equal(envKeySchema.parse('PG_URL_2'), 'PG_URL_2');
  assert.equal(envKeySchema.parse('  DATABASE_URL  '), 'DATABASE_URL');
});

test('rejects names that are not usable as environment variables', () => {
  assert.match(keyError('database_url'), /upper-case/i);
  assert.match(keyError('2FAST'), /upper-case/i);
  assert.match(keyError('DATABASE-URL'), /upper-case/i);
  assert.match(keyError('DATABASE URL'), /upper-case/i);
  assert.match(keyError(''), /Enter a variable name/);
});

test('deduplicates targets so one environment is never written twice', () => {
  const parsed = linkProjectSchema.parse({
    platform: 'vercel',
    projectId: 'prj_1',
    projectName: 'web',
    envKey: 'DATABASE_URL',
    targets: ['production', 'production', 'preview'],
  });
  assert.deepEqual(parsed.targets, ['production', 'preview']);
});

test('requires at least one environment', () => {
  const parsed = linkProjectSchema.safeParse({
    platform: 'vercel',
    projectId: 'prj_1',
    projectName: 'web',
    envKey: 'DATABASE_URL',
    targets: [],
  });
  assert.ok(!parsed.success);
  assert.match(parsed.error.issues[0]?.message ?? '', /at least one/);
});

test('rejects an unknown environment name', () => {
  const parsed = linkProjectSchema.safeParse({
    platform: 'vercel',
    projectId: 'prj_1',
    projectName: 'web',
    envKey: 'DATABASE_URL',
    targets: ['staging'],
  });
  assert.ok(!parsed.success);
});
