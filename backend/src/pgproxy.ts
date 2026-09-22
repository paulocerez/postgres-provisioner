import net from 'node:net';
import { eq } from 'drizzle-orm';
import { postgresDbName } from './coolify.js';
import { db } from './db/client.js';
import { databaseMeta } from './db/schema.js';
import { env, pgGatewayEnabled } from './env.js';

/**
 * A Postgres-protocol front door for databases that are *not* published on a
 * host port.
 *
 * The problem it solves: an IP allowlist cannot express serverless egress.
 * Vercel functions connect from rotating addresses, so the only allowlist that
 * would work is `0.0.0.0/0` — which is not an allowlist. The way out is to stop
 * routing by address and start authenticating the server instead.
 *
 * So Traefik terminates TLS on 443 with a real Let's Encrypt certificate and
 * routes by SNI to this listener, which reads the database name out of the
 * client's startup packet and pipes the socket to `<uuid>:5432` on the Coolify
 * Docker network. Three things follow:
 *
 *   - the client can use `sslmode=verify-full` — the first configuration here
 *     that actually authenticates the server, rather than merely encrypting;
 *   - no Postgres port is published, so `PORT_RANGE` can stay shut entirely and
 *     databases can be created `internal`;
 *   - the plaintext hop never leaves the host, so this path does not depend on
 *     Coolify's SSL flag, which the 4.3.21 API cannot set anyway.
 *
 * This listener must therefore never be published to the internet directly.
 * Bind it to localhost and let Traefik be the only thing that reaches it.
 */

/** Postgres' own cap (`MAX_STARTUP_PACKET_LENGTH`); anything larger is junk. */
const MAX_STARTUP_PACKET = 10000;

/** A client that connects and then says nothing is not a client. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_V3 = 196608;

export type StartupPacket =
  /** Not all the bytes have arrived yet — read more and try again. */
  | { kind: 'incomplete' }
  | { kind: 'ssl-request' }
  | { kind: 'gssenc-request' }
  | { kind: 'cancel-request' }
  | { kind: 'startup'; params: Record<string, string>; consumed: number }
  | { kind: 'invalid'; reason: string };

/**
 * Parses one startup packet out of `buffer`.
 *
 * Kept pure and total — it never throws and never touches a socket — because it
 * is the only part of this file that reads bytes off the public internet, and
 * that is exactly the part worth testing exhaustively.
 */
export function readStartupPacket(buffer: Buffer): StartupPacket {
  if (buffer.length < 4) return { kind: 'incomplete' };

  const length = buffer.readInt32BE(0);
  // The length counts its own four bytes, so anything below 8 cannot hold even
  // a protocol version.
  if (length < 8) return { kind: 'invalid', reason: `startup packet length ${length} is too small` };
  if (length > MAX_STARTUP_PACKET) {
    return { kind: 'invalid', reason: `startup packet length ${length} exceeds ${MAX_STARTUP_PACKET}` };
  }
  if (buffer.length < length) return { kind: 'incomplete' };

  const code = buffer.readInt32BE(4);
  if (code === SSL_REQUEST) return { kind: 'ssl-request' };
  if (code === GSSENC_REQUEST) return { kind: 'gssenc-request' };
  if (code === CANCEL_REQUEST) return { kind: 'cancel-request' };
  if (code !== PROTOCOL_V3) {
    const major = code >> 16;
    const minor = code & 0xffff;
    return { kind: 'invalid', reason: `unsupported protocol version ${major}.${minor}` };
  }

  // Key/value pairs, each NUL-terminated, ending with an empty key.
  const params: Record<string, string> = {};
  let offset = 8;
  for (;;) {
    if (offset >= length) {
      return { kind: 'invalid', reason: 'startup parameters are not terminated' };
    }
    const keyEnd = buffer.indexOf(0, offset);
    if (keyEnd === -1 || keyEnd >= length) {
      return { kind: 'invalid', reason: 'startup parameters are not terminated' };
    }
    if (keyEnd === offset) {
      // The empty key is the terminator.
      return { kind: 'startup', params, consumed: length };
    }
    const valueEnd = buffer.indexOf(0, keyEnd + 1);
    if (valueEnd === -1 || valueEnd >= length) {
      return { kind: 'invalid', reason: 'a startup parameter value is not terminated' };
    }
    params[buffer.toString('utf8', offset, keyEnd)] = buffer.toString('utf8', keyEnd + 1, valueEnd);
    offset = valueEnd + 1;
  }
}

/**
 * A Postgres ErrorResponse. Worth the few lines: without it a client that names
 * an unknown database sees the connection close with no explanation, which is
 * indistinguishable from a network fault. With it, `psql` prints the reason.
 *
 * `3D000` is invalid_catalog_name — the code a real server uses for exactly
 * this, so drivers classify it the way they already know how to.
 */
export function errorResponse(message: string, code = '3D000'): Buffer {
  const field = (tag: string, value: string) =>
    Buffer.concat([Buffer.from(tag, 'ascii'), Buffer.from(value, 'utf8'), Buffer.from([0])]);

  const body = Buffer.concat([
    field('S', 'FATAL'),
    field('V', 'FATAL'),
    field('C', code),
    field('M', message),
    Buffer.from([0]),
  ]);

  const header = Buffer.alloc(5);
  header.write('E', 0, 'ascii');
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

/**
 * The database name a client asked for, mapped to the Coolify uuid that is also
 * the container's hostname.
 *
 * Both spellings are accepted because both are things an operator legitimately
 * has in hand: the uuid is what the internal connection string uses, and the
 * Postgres database name is what the public one uses. `postgresDbName` is the
 * same transform used at create time, so the two can never drift.
 */
export function resolveBackendUuid(database: string): string | null {
  if (!database) return null;

  const direct = db
    .select()
    .from(databaseMeta)
    .where(eq(databaseMeta.coolifyUuid, database))
    .get();
  if (direct) return direct.coolifyUuid;

  for (const row of db.select().from(databaseMeta).all()) {
    if (postgresDbName(row.name) === database) return row.coolifyUuid;
  }
  return null;
}

function reject(socket: net.Socket, message: string, code?: string): void {
  socket.end(errorResponse(message, code));
}

function handleConnection(socket: net.Socket): void {
  let buffer = Buffer.alloc(0);
  // A client may legitimately send SSLRequest first even inside Traefik's TLS
  // tunnel — that is what `sslnegotiation=postgres`, the default, does. We
  // decline it with 'N' and let it continue in the clear, which is safe because
  // the clear part never leaves this host.
  let declinedEncryption = false;
  let piped = false;

  socket.setTimeout(HANDSHAKE_TIMEOUT_MS);
  socket.on('timeout', () => {
    if (!piped) socket.destroy();
  });
  socket.on('error', () => socket.destroy());

  socket.on('data', function onData(chunk: Buffer) {
    if (piped) return;

    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_STARTUP_PACKET) {
      reject(socket, 'Startup packet too large.', '08P01');
      return;
    }

    const packet = readStartupPacket(buffer);
    switch (packet.kind) {
      case 'incomplete':
        return;

      case 'ssl-request':
      case 'gssenc-request': {
        if (declinedEncryption) {
          reject(socket, 'Repeated encryption request.', '08P01');
          return;
        }
        declinedEncryption = true;
        buffer = buffer.subarray(8);
        socket.write(Buffer.from('N', 'ascii'));
        // A second packet may already be in the buffer; re-run against it.
        if (buffer.length > 0) onData(Buffer.alloc(0));
        return;
      }

      case 'cancel-request':
        // Cancellation carries a backend pid and key, not a database name, so
        // there is nothing here to route it by. Declining is honest; the query
        // simply runs to completion.
        socket.destroy();
        return;

      case 'invalid':
        reject(socket, `Bad startup packet: ${packet.reason}`, '08P01');
        return;

      case 'startup': {
        const database = packet.params.database ?? packet.params.user ?? '';
        const uuid = resolveBackendUuid(database);
        if (!uuid) {
          reject(socket, `No database named "${database}" is managed by this gateway.`);
          return;
        }

        piped = true;
        socket.setTimeout(0);
        // Stop the socket emitting while the upstream connection is opened.
        // Without this, anything the client sends in that window reaches the
        // handler above, which now ignores it — and those bytes are gone. Node
        // buffers them instead, and `pipe()` below resumes the flow.
        socket.pause();

        const upstream = net.connect({ host: uuid, port: 5432 });
        upstream.on('error', () => {
          if (!socket.destroyed) {
            reject(socket, `The database "${database}" is not accepting connections.`, '57P03');
          }
          upstream.destroy();
        });
        upstream.on('connect', () => {
          // Replay every byte read so far — the startup packet, and anything
          // the client pipelined behind it.
          upstream.write(buffer);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        socket.on('close', () => upstream.destroy());
        return;
      }
    }
  });
}

/**
 * Starts the gateway, or does nothing when it is not configured. Returns the
 * server so tests can drive it on an ephemeral port.
 */
export function startPgGateway(): net.Server | null {
  if (!pgGatewayEnabled) return null;

  const server = net.createServer(handleConnection);
  // Binds every interface *inside the container*, which is the normal thing to
  // do there. What keeps it off the internet is the port mapping: publish it as
  // `127.0.0.1:<port>:<port>` so only the host — and therefore only Traefik —
  // can reach it. Publishing it as `<port>:<port>` would undo the whole point.
  server.listen(env.PGPROXY_PORT, '0.0.0.0', () => {
    console.log(`[pg-gateway] listening on :${env.PGPROXY_PORT} for ${env.PG_GATEWAY_HOST}`);
  });
  server.on('error', (err) => {
    console.error('[pg-gateway] listener failed:', err);
  });
  return server;
}

export { handleConnection };
