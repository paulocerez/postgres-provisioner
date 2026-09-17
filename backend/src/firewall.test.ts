import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.PORT_RANGE_START ??= '5432';
process.env.PORT_RANGE_END ??= '5441';
process.env.COOLIFY_URL ??= 'http://localhost:8000';
process.env.COOLIFY_TOKEN ??= 'test-token';
process.env.PUBLIC_HOST ??= '127.0.0.1';
process.env.ADMIN_EMAIL ??= 'admin@example.com';
process.env.ADMIN_PASSWORD_HASH ??= '$2a$04$CGH7aUgMT0N/m9CZzgEazeqntdOffBIWzuTYoyFONasZmIS/CyoMy';
process.env.SESSION_SECRET ??= 'x'.repeat(32);
process.env.APP_ORIGIN ??= 'http://localhost:5173';
// firewall.ts reaches the SQLite client through its imports; keep that out of
// the real data directory.
process.env.DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'pgp-test-'));

const { findConflictingRule } = await import('./firewall.js');
type Rule = Parameters<typeof findConflictingRule>[0][number];

const managed: Rule = {
  direction: 'in',
  protocol: 'tcp',
  port: '5433',
  source_ips: ['203.0.113.4/32'],
  description: 'pgp:abc123',
};

const ssh: Rule = {
  direction: 'in',
  protocol: 'tcp',
  port: '22',
  source_ips: ['0.0.0.0/0'],
  description: 'ssh',
};

test('our own rule is never reported as a conflict', () => {
  assert.equal(findConflictingRule([managed], 5433), null);
});

test('an unrelated port is not a conflict', () => {
  assert.equal(findConflictingRule([ssh], 5433), null);
});

test('a hand-written rule covering the range is a conflict', () => {
  const wide: Rule = {
    direction: 'in',
    protocol: 'tcp',
    port: '5432-5441',
    source_ips: ['0.0.0.0/0'],
    description: 'postgres',
  };
  assert.match(String(findConflictingRule([ssh, wide], 5433)), /5432-5441/);
});

test('a rule with no port covers everything', () => {
  const any: Rule = { direction: 'in', protocol: 'tcp', port: null, source_ips: ['0.0.0.0/0'] };
  assert.match(String(findConflictingRule([any], 5433)), /any port/);
});

test('outbound and non-tcp rules are ignored', () => {
  const out: Rule = { direction: 'out', protocol: 'tcp', port: '5433', destination_ips: ['0.0.0.0/0'] };
  const udp: Rule = { direction: 'in', protocol: 'udp', port: '5433', source_ips: ['0.0.0.0/0'] };
  assert.equal(findConflictingRule([out, udp], 5433), null);
});

test('a pgp: rule outside the port range is not ours, so it conflicts', () => {
  const stray: Rule = {
    direction: 'in',
    protocol: 'tcp',
    port: '6000',
    source_ips: ['0.0.0.0/0'],
    description: 'pgp:someone-else',
  };
  assert.notEqual(findConflictingRule([stray], 6000), null);
});
