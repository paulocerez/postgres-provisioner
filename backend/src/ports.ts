import type { RawDatabase } from './coolify.js';
import { env } from './env.js';

/**
 * Port allocation is stateless: Coolify is asked what is in use on every create,
 * so a database deleted outside this app frees its port immediately.
 */

export class PortRangeExhaustedError extends Error {
  constructor(start: number, end: number) {
    super(
      `All host ports in ${start}-${end} are in use. Free one, or widen PORT_RANGE_START/PORT_RANGE_END (the Hetzner firewall must allow the new range too).`,
    );
    this.name = 'PortRangeExhaustedError';
  }
}

export function usedPorts(databases: Pick<RawDatabase, 'public_port'>[]): Set<number> {
  const used = new Set<number>();
  for (const database of databases) {
    if (typeof database.public_port === 'number') used.add(database.public_port);
  }
  return used;
}

/**
 * Lowest free port in the configured range, so deleting a database and creating
 * a new one reuses the gap rather than drifting upwards.
 *
 * @param exclude ports to treat as taken even though Coolify does not list them
 *   yet — used by the post-create race re-check.
 */
export function allocatePort(
  databases: Pick<RawDatabase, 'public_port'>[],
  exclude: Iterable<number> = [],
): number {
  const used = usedPorts(databases);
  for (const port of exclude) used.add(port);

  for (let port = env.PORT_RANGE_START; port <= env.PORT_RANGE_END; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new PortRangeExhaustedError(env.PORT_RANGE_START, env.PORT_RANGE_END);
}
