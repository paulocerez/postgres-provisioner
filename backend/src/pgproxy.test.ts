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
// pgproxy.ts reaches SQLite through its imports; keep that out of the real
// data directory.
process.env.DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'pgp-test-'));

const { readStartupPacket, errorResponse } = await import('./pgproxy.js');

/** Builds a v3 StartupMessage the way a real client does. */
function startup(params: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(params)) {
    parts.push(Buffer.from(`${key}\0${value}\0`, 'utf8'));
  }
  parts.push(Buffer.from([0]));
  const body = Buffer.concat(parts);
  const packet = Buffer.alloc(8 + body.length);
  packet.writeInt32BE(packet.length, 0);
  packet.writeInt32BE(196608, 4);
  body.copy(packet, 8);
  return packet;
}

/** The 8-byte request packets: SSLRequest, GSSENCRequest, CancelRequest. */
function request(code: number, length = 8): Buffer {
  const packet = Buffer.alloc(length);
  packet.writeInt32BE(length, 0);
  packet.writeInt32BE(code, 4);
  return packet;
}

test('parses a startup message into its parameters', () => {
  const packet = startup({ user: 'postgres', database: 'demo_db', application_name: 'psql' });
  const result = readStartupPacket(packet);
  assert.equal(result.kind, 'startup');
  assert.deepEqual(result.kind === 'startup' ? result.params : null, {
    user: 'postgres',
    database: 'demo_db',
    application_name: 'psql',
  });
  assert.equal(result.kind === 'startup' ? result.consumed : 0, packet.length);
});

test('reports incomplete until every byte has arrived', () => {
  const packet = startup({ user: 'postgres', database: 'demo_db' });
  // A TCP read can split anywhere; every prefix must be safe to parse.
  for (let i = 0; i < packet.length; i += 1) {
    assert.equal(readStartupPacket(packet.subarray(0, i)).kind, 'incomplete', `prefix of ${i}`);
  }
  assert.equal(readStartupPacket(packet).kind, 'startup');
});

test('recognises the three special request packets', () => {
  assert.equal(readStartupPacket(request(80877103)).kind, 'ssl-request');
  assert.equal(readStartupPacket(request(80877104)).kind, 'gssenc-request');
  assert.equal(readStartupPacket(request(80877102, 16)).kind, 'cancel-request');
});

test('rejects a protocol version it cannot speak', () => {
  // Protocol 2.0, which this gateway does not forward.
  const result = readStartupPacket(request(131072));
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.reason : '', /2\.0/);
});

test('rejects an oversized length without allocating for it', () => {
  const packet = Buffer.alloc(16);
  packet.writeInt32BE(50_000_000, 0);
  packet.writeInt32BE(196608, 4);
  const result = readStartupPacket(packet);
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.reason : '', /exceeds 10000/);
});

test('rejects a length too small to hold a version', () => {
  const packet = Buffer.alloc(8);
  packet.writeInt32BE(4, 0);
  const result = readStartupPacket(packet);
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.reason : '', /too small/);
});

test('rejects parameters that run past the end of the packet', () => {
  // A well-formed length, but the key/value block never terminates.
  const body = Buffer.from('user\0postgres\0', 'utf8');
  const packet = Buffer.alloc(8 + body.length);
  packet.writeInt32BE(packet.length, 0);
  packet.writeInt32BE(196608, 4);
  body.copy(packet, 8);
  const result = readStartupPacket(packet);
  assert.equal(result.kind, 'invalid');
  assert.match(result.kind === 'invalid' ? result.reason : '', /not terminated/);
});

test('handles a startup message with no parameters at all', () => {
  const result = readStartupPacket(startup({}));
  assert.equal(result.kind, 'startup');
  assert.deepEqual(result.kind === 'startup' ? result.params : null, {});
});

test('builds an ErrorResponse a client can actually read', () => {
  const buffer = errorResponse('No database named "nope".');
  assert.equal(String.fromCharCode(buffer[0]), 'E');
  // The length field covers the body plus its own four bytes, not the tag.
  assert.equal(buffer.readInt32BE(1), buffer.length - 1);
  const body = buffer.toString('utf8', 5);
  assert.match(body, /FATAL/);
  assert.match(body, /3D000/);
  assert.match(body, /No database named "nope"\./);
  assert.equal(buffer[buffer.length - 1], 0);
});

// --- socket behaviour --------------------------------------------------------

const net = await import('node:net');
const { handleConnection } = await import('./pgproxy.js');
const { runMigrations } = await import('./db/client.js');

runMigrations();

/** Runs `handleConnection` on an ephemeral port and hands back a client socket. */
async function connect(): Promise<{ client: import('node:net').Socket; close: () => void }> {
  const server = net.createServer(handleConnection);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as import('node:net').AddressInfo;
  const client = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  return { client, close: () => { client.destroy(); server.close(); } };
}

/** Collects bytes until `predicate` is happy, or the socket ends. */
function collect(
  socket: import('node:net').Socket,
  predicate: (b: Buffer) => boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let seen = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error(`timed out; saw ${seen.length} bytes`)), 4000);
    socket.on('data', (chunk) => {
      seen = Buffer.concat([seen, chunk]);
      if (predicate(seen)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(seen);
    });
  });
}

test('declines an SSLRequest with N so the client can continue in the clear', async () => {
  const { client, close } = await connect();
  try {
    client.write(request(80877103));
    const seen = await collect(client, (b) => b.length >= 1);
    assert.equal(seen.subarray(0, 1).toString('ascii'), 'N');
  } finally {
    close();
  }
});

test('an unknown database gets an ErrorResponse, not a silent close', async () => {
  const { client, close } = await connect();
  try {
    client.write(startup({ user: 'postgres', database: 'no_such_db' }));
    const seen = await collect(client, (b) => b.length > 0 && b[0] === 0x45);
    assert.equal(seen.subarray(0, 1).toString('ascii'), 'E');
    assert.match(seen.toString('utf8'), /No database named "no_such_db"/);
    assert.match(seen.toString('utf8'), /3D000/);
  } finally {
    close();
  }
});

test('an SSLRequest followed by a startup message is handled as one stream', async () => {
  const { client, close } = await connect();
  try {
    // Both packets in a single write — the buffered second packet must still be
    // parsed after the 'N' is sent, rather than waiting for another read.
    client.write(Buffer.concat([request(80877103), startup({ database: 'still_unknown' })]));
    const seen = await collect(client, (b) => b.includes(Buffer.from('still_unknown')));
    assert.equal(seen.subarray(0, 1).toString('ascii'), 'N');
    assert.match(seen.toString('utf8'), /No database named "still_unknown"/);
  } finally {
    close();
  }
});

test('a malformed packet is refused with a protocol error', async () => {
  const { client, close } = await connect();
  try {
    const bad = Buffer.alloc(8);
    bad.writeInt32BE(8, 0);
    bad.writeInt32BE(131072, 4); // protocol 2.0
    client.write(bad);
    const seen = await collect(client, (b) => b.length > 0 && b[0] === 0x45);
    assert.match(seen.toString('utf8'), /08P01/);
    assert.match(seen.toString('utf8'), /2\.0/);
  } finally {
    close();
  }
});

test('resolves a database name and a uuid to the same backend', async () => {
  const { resolveBackendUuid } = await import('./pgproxy.js');
  const { db } = await import('./db/client.js');
  const { databaseMeta } = await import('./db/schema.js');

  db.insert(databaseMeta)
    .values({
      coolifyUuid: 'kso8w0kcgws4',
      // Coolify names the resource with hyphens; the Postgres database inside
      // it has underscores. A client connects with the latter.
      name: 'demo-db',
      project: null,
      owner: null,
      notes: null,
      postgresPassword: 'secret',
      createdBy: 'test',
      createdAt: Date.now(),
    })
    .run();

  assert.equal(resolveBackendUuid('demo_db'), 'kso8w0kcgws4');
  assert.equal(resolveBackendUuid('kso8w0kcgws4'), 'kso8w0kcgws4');
  assert.equal(resolveBackendUuid('demo-db'), null);
  assert.equal(resolveBackendUuid('nope'), null);
  assert.equal(resolveBackendUuid(''), null);
});
