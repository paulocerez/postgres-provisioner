import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PORT_RANGE_START ??= '5432';
process.env.PORT_RANGE_END ??= '5441';
process.env.COOLIFY_URL ??= 'http://localhost:8000';
process.env.COOLIFY_TOKEN ??= 'test-token';
process.env.PUBLIC_HOST ??= '127.0.0.1';
process.env.ADMIN_EMAIL ??= 'admin@example.com';
// Shape matters to env.ts, so this has to look like a real bcrypt hash.
process.env.ADMIN_PASSWORD_HASH ??= '$2a$04$CGH7aUgMT0N/m9CZzgEazeqntdOffBIWzuTYoyFONasZmIS/CyoMy';
process.env.SESSION_SECRET ??= 'x'.repeat(32);
process.env.APP_ORIGIN ??= 'http://localhost:5173';

const { allocatePort, PortRangeExhaustedError } = await import('./ports.js');

test('allocates the range start when nothing is in use', () => {
  assert.equal(allocatePort([]), 5432);
});

test('fills the lowest gap so a deleted database frees its port', () => {
  assert.equal(allocatePort([{ public_port: 5432 }, { public_port: 5434 }]), 5433);
});

test('ignores databases with no public port', () => {
  assert.equal(allocatePort([{ public_port: null }, { public_port: 5432 }]), 5433);
});

test('honours the exclude set used by the post-create race re-check', () => {
  assert.equal(allocatePort([{ public_port: 5432 }], [5433]), 5434);
});

test('refuses clearly when the whole range is taken', () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ public_port: 5432 + i }));
  assert.throws(() => allocatePort(full), PortRangeExhaustedError);
});
