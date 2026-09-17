import { env } from './env.js';
import { redactString } from './audit.js';

/**
 * Minimal Hetzner Cloud API client — only what a firewall needs. Deliberately
 * shaped like `coolify.ts`: raw interfaces for the wire format, one `request`
 * wrapper, a typed error, and no zod on responses.
 *
 * Unlike Coolify, this API is public, versioned and stable, so the field map is
 * short. The one thing worth writing down is that `set_rules` replaces the
 * firewall's *entire* rule set — there is no add-one-rule endpoint, and no
 * optimistic-concurrency token to detect a rule someone changed in the console
 * meanwhile. Every write is therefore a read-modify-write, and `firewall.ts`
 * serialises them.
 */

const API_URL = 'https://api.hetzner.cloud/v1';
const REQUEST_TIMEOUT_MS = 10_000;

export interface HetznerRule {
  direction: 'in' | 'out';
  protocol: 'tcp' | 'udp' | 'icmp' | 'esp' | 'gre';
  /** Absent for icmp/esp/gre. A single port ("5433") or a range ("5432-5441"). */
  port?: string | null;
  source_ips?: string[];
  destination_ips?: string[];
  description?: string | null;
}

interface FirewallResponse {
  firewall: { id: number; name: string; rules: HetznerRule[] };
}

export class HetznerError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body: string;

  constructor(status: number, endpoint: string, body: string, message?: string) {
    super(message ?? `Hetzner ${status} on ${endpoint}: ${body || '(empty response)'}`);
    this.name = 'HetznerError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

async function request<T>(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<T> {
  if (!env.HCLOUD_TOKEN) {
    throw new HetznerError(0, endpoint, '', 'HCLOUD_TOKEN is not set.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.HCLOUD_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new HetznerError(0, endpoint, reason, `Could not reach the Hetzner API (${reason}).`);
  }

  const text = await response.text();

  if (!response.ok) {
    const detail = redactString(text).slice(0, 500);
    if (response.status === 401 || response.status === 403) {
      throw new HetznerError(
        response.status,
        endpoint,
        detail,
        'Hetzner rejected the API token. It needs read *and* write permission on this project.',
      );
    }
    if (response.status === 404) {
      throw new HetznerError(
        response.status,
        endpoint,
        detail,
        `Hetzner has no firewall with id ${env.HCLOUD_FIREWALL_ID}. Check HCLOUD_FIREWALL_ID.`,
      );
    }
    // Hetzner rate-limits per project and says so in a header rather than the
    // body, so name the cause here — a bare 502 sends the operator looking in
    // the wrong place.
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new HetznerError(
        429,
        endpoint,
        detail,
        `Hetzner rate limit reached${retryAfter ? `; retry in ${retryAfter}s` : ''}. Nothing was changed.`,
      );
    }
    throw new HetznerError(response.status, endpoint, detail);
  }

  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HetznerError(
      response.status,
      endpoint,
      redactString(text).slice(0, 500),
      `Hetzner returned a non-JSON response for ${endpoint}.`,
    );
  }
}

function firewallId(): number {
  const id = env.HCLOUD_FIREWALL_ID;
  if (!id) throw new HetznerError(0, '/firewalls', '', 'HCLOUD_FIREWALL_ID is not set.');
  return id;
}

export async function getFirewallRules(): Promise<HetznerRule[]> {
  const body = await request<FirewallResponse>('GET', `/firewalls/${firewallId()}`);
  return body.firewall?.rules ?? [];
}

/** Replaces every rule on the firewall. Callers must pass the full desired set. */
export async function setFirewallRules(rules: HetznerRule[]): Promise<void> {
  await request('POST', `/firewalls/${firewallId()}/actions/set_rules`, { rules });
}
