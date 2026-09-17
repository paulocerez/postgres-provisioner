import { db } from './db/client.js';
import { databaseAllowlist } from './db/schema.js';
import { env, firewallManaged } from './env.js';
import { listDatabases } from './coolify.js';
import { HetznerError, getFirewallRules, setFirewallRules, type HetznerRule } from './hetzner.js';

/**
 * Turns the `database_allowlist` table into inbound rules on one Hetzner
 * firewall.
 *
 * Ownership is narrow on purpose. A rule belongs to this app only if it is
 * inbound TCP, its port is a single port inside PORT_RANGE, *and* its
 * description starts with `pgp:`. Everything else — SSH, HTTP, anything added
 * by hand — is copied through untouched, because `set_rules` replaces the whole
 * rule set and a mistake here locks the operator out of their own server.
 *
 * The corollary is worth stating plainly: a hand-written rule that already
 * opens the port range keeps the port open to the world, since it carries no
 * `pgp:` description. Until it is deleted in the console, an allowlist here can
 * only widen access. `findConflictingRule` exists so the UI can say that.
 */

const RULE_PREFIX = 'pgp:';

/** Hetzner's documented ceiling; hitting it silently would drop rules. */
const MAX_RULES = 50;

export function describeRule(rule: HetznerRule): string {
  const source = rule.source_ips?.length ? rule.source_ips.join(', ') : 'any source';
  const port = rule.port ? `port ${rule.port}` : 'any port';
  const description = rule.description ? ` (${rule.description})` : '';
  return `${rule.protocol} ${port} from ${source}${description}`;
}

function managedUuid(rule: HetznerRule): string | null {
  if (rule.direction !== 'in' || rule.protocol !== 'tcp') return null;
  if (!rule.description?.startsWith(RULE_PREFIX)) return null;
  const port = Number(rule.port);
  if (!Number.isInteger(port)) return null;
  if (port < env.PORT_RANGE_START || port > env.PORT_RANGE_END) return null;
  return rule.description.slice(RULE_PREFIX.length);
}

/**
 * Whether a rule we do not own also covers `port`. Handles the single-port,
 * range and "all ports" spellings Hetzner accepts.
 */
export function findConflictingRule(rules: HetznerRule[], port: number): string | null {
  for (const rule of rules) {
    if (rule.direction !== 'in' || rule.protocol !== 'tcp') continue;
    if (managedUuid(rule) !== null) continue;

    const spec = rule.port?.trim();
    if (!spec || spec === 'any') return describeRule(rule);

    const [from, to] = spec.split('-');
    const start = Number(from);
    const end = to === undefined ? start : Number(to);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (port >= start && port <= end) return describeRule(rule);
  }
  return null;
}

/** Rules read straight from Hetzner, or null when the feature is off. */
export async function readFirewallRules(): Promise<HetznerRule[] | null> {
  if (!firewallManaged) return null;
  return getFirewallRules();
}

function canonical(rules: HetznerRule[]): string {
  return JSON.stringify(
    rules
      .map((rule) => ({
        port: rule.port ?? '',
        description: rule.description ?? '',
        sources: [...(rule.source_ips ?? [])].sort(),
      }))
      .sort((a, b) => a.description.localeCompare(b.description)),
  );
}

let inFlight: Promise<void> = Promise.resolve();

/**
 * Applies the current allowlist table to the firewall. Serialised, because
 * `set_rules` is a read-modify-write with no compare-and-swap: two concurrent
 * reconciles would each write a rule set built from a stale read.
 */
export function reconcileFirewall(): Promise<void> {
  const next = inFlight.then(
    () => doReconcile(),
    () => doReconcile(),
  );
  // Keep the chain alive after a failure; the next caller still gets to run.
  inFlight = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function doReconcile(): Promise<void> {
  if (!firewallManaged) return;

  // Coolify owns the port assignment, so the desired rules cannot be derived
  // from SQLite alone.
  const databases = await listDatabases();
  const portByUuid = new Map<string, number>();
  for (const raw of databases) {
    if (raw.is_public && raw.public_port) portByUuid.set(raw.uuid, raw.public_port);
  }

  const sourcesByUuid = new Map<string, string[]>();
  for (const row of db.select().from(databaseAllowlist).all()) {
    const list = sourcesByUuid.get(row.coolifyUuid);
    if (list) list.push(row.cidr);
    else sourcesByUuid.set(row.coolifyUuid, [row.cidr]);
  }

  const desired: HetznerRule[] = [];
  for (const [uuid, port] of portByUuid) {
    const sources = sourcesByUuid.get(uuid);
    // No entries means no rule at all — the port stays shut rather than open.
    if (!sources?.length) continue;
    desired.push({
      direction: 'in',
      protocol: 'tcp',
      port: String(port),
      source_ips: [...sources].sort(),
      description: `${RULE_PREFIX}${uuid}`,
    });
  }

  const current = await getFirewallRules();
  const preserved = current.filter((rule) => managedUuid(rule) === null);
  const managed = current.filter((rule) => managedUuid(rule) !== null);

  if (canonical(managed) === canonical(desired)) return;

  const rules = [...preserved, ...desired];
  if (rules.length > MAX_RULES) {
    throw new HetznerError(
      0,
      '/firewalls',
      '',
      `This change would need ${rules.length} firewall rules; Hetzner allows ${MAX_RULES}. Nothing was changed.`,
    );
  }

  await setFirewallRules(rules);
}
