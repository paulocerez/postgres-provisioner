import { redactString } from './audit.js';
import { env } from './env.js';

/**
 * Minimal Vercel API client — only what pushing a connection string needs.
 * Shaped like `hetzner.ts`: raw interfaces for the wire format, one `request`
 * wrapper, a typed error, no zod on responses.
 *
 * The one property worth writing down is that `POST /v10/projects/{id}/env`
 * with `upsert=true` is idempotent. That matters because the alternative —
 * create, catch the "already exists" 403, then patch — needs the variable's id,
 * which needs another round trip, and would race with anyone editing the same
 * variable in the dashboard. Upsert makes re-pushing a rotated string one call
 * with no read.
 */

const API_URL = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** Vercel's own environments. A push targets all three unless told otherwise. */
export const VERCEL_TARGETS = ['production', 'preview', 'development'] as const;
export type VercelTarget = (typeof VERCEL_TARGETS)[number];

export interface VercelProject {
  id: string;
  name: string;
  framework?: string | null;
}

interface ProjectsResponse {
  projects: VercelProject[];
  pagination?: { next?: number | null };
}

interface EnvResponse {
  created?: unknown;
  failed?: { error: { code: string; message: string; key?: string } }[];
}

export class VercelError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body: string;

  constructor(status: number, endpoint: string, body: string, message?: string) {
    super(message ?? `Vercel ${status} on ${endpoint}: ${body || '(empty response)'}`);
    this.name = 'VercelError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

/** Appends `teamId` when one is configured; personal accounts omit it. */
function withTeam(endpoint: string): string {
  if (!env.VERCEL_TEAM_ID) return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
}

async function request<T>(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<T> {
  if (!env.VERCEL_TOKEN) {
    throw new VercelError(0, endpoint, '', 'VERCEL_TOKEN is not set.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${withTeam(endpoint)}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VercelError(0, endpoint, reason, `Could not reach the Vercel API (${reason}).`);
  }

  const text = await response.text();

  if (!response.ok) {
    // The body of a failed env write echoes the value that was being written,
    // which is a connection string. Never let it through unredacted.
    const detail = redactString(text).slice(0, 500);
    if (response.status === 401 || response.status === 403) {
      throw new VercelError(
        response.status,
        endpoint,
        detail,
        'Vercel rejected the API token. Check VERCEL_TOKEN, and that it covers the team in VERCEL_TEAM_ID.',
      );
    }
    if (response.status === 404) {
      throw new VercelError(
        response.status,
        endpoint,
        detail,
        env.VERCEL_TEAM_ID
          ? 'Vercel has no such project in this team. Check VERCEL_TEAM_ID.'
          : 'Vercel has no such project. If it belongs to a team, set VERCEL_TEAM_ID.',
      );
    }
    if (response.status === 429) {
      throw new VercelError(429, endpoint, detail, 'Vercel rate limit reached. Nothing was changed.');
    }
    throw new VercelError(response.status, endpoint, detail);
  }

  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new VercelError(
      response.status,
      endpoint,
      redactString(text).slice(0, 500),
      `Vercel returned a non-JSON response for ${endpoint}.`,
    );
  }
}

/**
 * Every project the token can see, newest first. Paged through in full: a team
 * with more projects than one page would otherwise silently miss the one the
 * operator is looking for, and the list is only ever rendered in a picker.
 */
export async function listProjects(): Promise<VercelProject[]> {
  const projects: VercelProject[] = [];
  let until: number | null | undefined;

  // Bounded rather than `while (true)`: a paging bug upstream should degrade to
  // a short list, not an infinite loop holding a request open.
  for (let page = 0; page < 20; page += 1) {
    const query = `/v9/projects?limit=100${until ? `&until=${until}` : ''}`;
    const body = await request<ProjectsResponse>('GET', query);
    projects.push(...(body.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
    until = body.pagination?.next;
    if (!until) break;
  }

  return projects;
}

/**
 * Writes one environment variable, creating or replacing it.
 *
 * `type: 'sensitive'` means Vercel stores it write-only: it is never shown
 * again in their dashboard or returned by their API. That is the right shape
 * for a connection string, and it is also why this app remains the only place
 * the value can be read back.
 */
export async function upsertProjectEnv(input: {
  projectId: string;
  key: string;
  value: string;
  targets: readonly VercelTarget[];
  comment?: string;
}): Promise<void> {
  const body = await request<EnvResponse>('POST', `/v10/projects/${input.projectId}/env?upsert=true`, {
    key: input.key,
    value: input.value,
    type: 'sensitive',
    target: [...input.targets],
    ...(input.comment ? { comment: input.comment } : {}),
  });

  // A 200 with a populated `failed` array is Vercel's partial-success shape.
  // Treating it as success would report a link the project does not have.
  const failed = body?.failed ?? [];
  if (failed.length > 0) {
    const reason = failed
      .map((f) => f.error?.message)
      .filter(Boolean)
      .join('; ');
    throw new VercelError(
      0,
      `/v10/projects/${input.projectId}/env`,
      '',
      `Vercel refused the variable: ${reason || 'no reason given'}.`,
    );
  }
}
