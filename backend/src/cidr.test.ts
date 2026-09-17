import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCidr } from '@app/shared';

/**
 * Hetzner rejects a source range whose host bits are set, and the operator only
 * finds out through a 422 they never asked for. These cases are the ones that
 * reach that error in practice.
 */

function value(raw: string): string {
  const parsed = parseCidr(raw);
  assert.ok(parsed.ok, `expected ${raw} to parse: ${parsed.ok ? '' : parsed.message}`);
  return parsed.value;
}

function message(raw: string): string {
  const parsed = parseCidr(raw);
  assert.ok(!parsed.ok, `expected ${raw} to be rejected`);
  return parsed.message;
}

test('accepts a single IPv4 address', () => {
  assert.equal(value('203.0.113.4/32'), '203.0.113.4/32');
});

test('accepts a network and normalises whitespace and case', () => {
  assert.equal(value('  203.0.113.0/24  '), '203.0.113.0/24');
  assert.equal(value('2001:DB8::/32'), '2001:db8:0:0:0:0:0:0/32');
});

test('rejects a range with host bits set, naming both fixes', () => {
  const msg = message('203.0.113.4/24');
  assert.match(msg, /203\.0\.113\.0\/24/);
  assert.match(msg, /203\.0\.113\.4\/32/);
});

test('rejects a bare address so the prefix is never guessed', () => {
  assert.match(message('203.0.113.4'), /\/32/);
  assert.match(message('2001:db8::1'), /\/128/);
});

test('rejects out-of-range octets and prefixes', () => {
  assert.match(message('203.0.113.256/32'), /256/);
  assert.match(message('203.0.113.4/33'), /\/0 and \/32/);
  assert.match(message('2001:db8::/129'), /\/0 and \/128/);
});

test('rejects leading zeros rather than guessing the base', () => {
  assert.match(message('203.0.113.010/32'), /010/);
});

test('handles IPv6 host bits and "::" placement', () => {
  assert.equal(value('2001:db8:1::/48'), '2001:db8:1:0:0:0:0:0/48');
  assert.match(message('2001:db8::1/64'), /Host bits/);
  assert.match(message('2001::db8::1/128'), /at most once/);
});
