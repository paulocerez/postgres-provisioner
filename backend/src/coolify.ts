import type {
  Database as NormalisedDatabase,
  DatabaseMeta,
  DatabaseStatus,
} from '@app/shared';
import { redactString } from './audit.js';
import { env } from './env.js';

/**
 * The only place that talks to Coolify. The React client never sees
 * COOLIFY_TOKEN and never calls Coolify directly.
 *
 * Coolify renames API fields between releases, so every version-dependent name
 * lives in the FIELD MAP below and nowhere else. If the installed version
 * disagrees with these guesses, that block is the only thing to edit — run
 * `GET /api/v1/databases` with a real token and diff the keys.
 */

// ---------------------------------------------------------------------------
// --- COOLIFY FIELD MAP -----------------------------------------------------
// Verified against: <unverified — spec section 5.1, adapt after first deploy>
// ---------------------------------------------------------------------------

/** A Postgres resource as returned by `GET /databases` and `GET /databases/{uuid}`. */
export interface RawDatabase {
  uuid: string;
  name: string;
  description?: string | null;
  /** 'running', 'running:healthy', 'exited', 'restarting', 'degraded' ... */
  status?: string | null;
  image?: string | null;
  is_public?: boolean | null;
  public_port?: number | null;
  enable_ssl?: boolean | null;
  ssl_mode?: string | null;
  postgres_user?: string | null;
  postgres_password?: string | null;
  postgres_db?: string | null;
  internal_db_url?: string | null;
  external_db_url?: string | null;
  created_at?: string | null;
  destination?: { server?: { name?: string } } | null;
  environment_name?: string | null;
}

interface RawServer {
  uuid: string;
  name: string;
}

interface RawProject {
  uuid: string;
  name: string;
  environments?: Array<{ uuid: string; name: string }>;
}

interface RawBackup {
  uuid?: string;
  enabled?: boolean | null;
  frequency?: string | null;
  database_backup_executions?: Array<{
    created_at?: string | null;
    status?: string | null;
  }> | null;
}

/** Body for `POST /databases/postgresql`. */
function buildCreatePayload(input: {
  name: string;
  description?: string;
  image: string;
  isPublic: boolean;
  publicPort: number | null;
  serverUuid: string;
  projectUuid: string;
}): Record<string, unknown> {
  return {
    server_uuid: input.serverUuid,
    project_uuid: input.projectUuid,
    environment_name: env.COOLIFY_ENVIRONMENT,
    name: input.name,
    description: input.description ?? '',
    image: input.image,
    postgres_user: 'postgres',
    postgres_db: input.name.replace(/-/g, '_'),
    is_public: input.isPublic,
    ...(input.publicPort !== null ? { public_port: input.publicPort } : {}),
    instant_deploy: false,
  };
}

/** Body for the pre-start `PATCH /databases/{uuid}`. */
function buildConfigurePayload(input: {
  isPublic: boolean;
  publicPort: number | null;
}): Record<string, unknown> {
  return {
    enable_ssl: true,
    ssl_mode: 'require',
    is_public: input.isPublic,
    ...(input.publicPort !== null ? { public_port: input.publicPort } : {}),
  };
}

/** Coolify's status strings are free-form; anything unrecognised is 'unknown'. */
function mapStatus(raw: string | null | undefined): DatabaseStatus {
  if (!raw) return 'unknown';
  const value = raw.toLowerCase();
  if (value.startsWith('running')) return 'running';
  if (value.startsWith('starting') || value.startsWith('restarting')) return 'starting';
  if (value.startsWith('exited')) return 'exited';
  if (value.startsWith('stopped') || value.startsWith('degraded')) return 'stopped';
  return 'unknown';
}

function versionFromImage(image: string | null | undefined): string {
  const match = /postgres:(\d+)/.exec(image ?? '');
  return match?.[1] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// --- end FIELD MAP ---------------------------------------------------------
// ---------------------------------------------------------------------------

export class CoolifyError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body: string;

  constructor(status: number, endpoint: string, body: string, message?: string) {
    super(message ?? `Coolify ${status} on ${endpoint}: ${body || '(empty response)'}`);
    this.name = 'CoolifyError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  endpoint: string,
  body?: unknown,
): Promise<T> {
  const url = `${env.COOLIFY_URL.replace(/\/$/, '')}/api/v1${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.COOLIFY_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CoolifyError(
      0,
      endpoint,
      reason,
      `Could not reach Coolify at ${env.COOLIFY_URL} (${reason}).`,
    );
  }

  const text = await response.text();

  if (!response.ok) {
    throw new CoolifyError(response.status, endpoint, redactString(text).slice(0, 500));
  }

  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CoolifyError(
      response.status,
      endpoint,
      redactString(text).slice(0, 500),
      `Coolify returned a non-JSON response for ${endpoint}.`,
    );
  }
}

// --- resolved-once instance facts -------------------------------------------

interface Resolved {
  version: string | null;
  serverUuid: string;
  projectUuid: string;
  projectName: string | null;
  backupsSupported: boolean;
}

let resolved: Resolved | null = null;

/**
 * Resolves the server/project uuids (by name, if not pinned in env) and probes
 * whether this Coolify version exposes a backups endpoint. Called once at
 * startup; failures here must not stop the server from booting, because the UI
 * needs to be reachable in order to *show* that Coolify is unreachable.
 */
export async function resolveInstance(): Promise<Resolved> {
  const version = await request<{ version?: string } | string>('GET', '/version')
    .then((v) => (typeof v === 'string' ? v : (v?.version ?? null)))
    .catch(() => null);

  let serverUuid = env.COOLIFY_SERVER_UUID ?? '';
  if (!serverUuid) {
    const servers = await request<RawServer[]>('GET', '/servers');
    const match = servers.find((s) => s.name === 'localhost') ?? servers[0];
    if (!match) throw new CoolifyError(0, '/servers', '', 'Coolify reports no servers.');
    serverUuid = match.uuid;
  }

  let projectUuid = env.COOLIFY_PROJECT_UUID ?? '';
  let projectName: string | null = null;
  const projects = await request<RawProject[]>('GET', '/projects');
  if (!projectUuid) {
    const first = projects[0];
    if (!first) throw new CoolifyError(0, '/projects', '', 'Coolify reports no projects.');
    projectUuid = first.uuid;
    projectName = first.name;
  } else {
    projectName = projects.find((p) => p.uuid === projectUuid)?.name ?? null;
  }

  const backupsSupported = await probeBackupsSupport();

  resolved = { version, serverUuid, projectUuid, projectName, backupsSupported };
  return resolved;
}

/**
 * Backup scheduling is the most likely gap between Coolify versions (spec 5.1).
 * A 404/405 means "unsupported" and the UI falls back to a link; any other
 * failure is treated as unsupported too, rather than blocking database creation.
 */
async function probeBackupsSupport(): Promise<boolean> {
  try {
    const databases = await request<RawDatabase[]>('GET', '/databases');
    const sample = databases[0];
    if (!sample) return Boolean(env.COOLIFY_S3_STORAGE_UUID);
    await request<RawBackup[]>('GET', `/databases/${sample.uuid}/backups`);
    return true;
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) return false;
    return false;
  }
}

export function getResolved(): Resolved | null {
  return resolved;
}

export function requireResolved(): Resolved {
  if (!resolved) {
    throw new CoolifyError(
      0,
      '/version',
      '',
      'Coolify is not reachable — the server could not resolve its project and server on startup.',
    );
  }
  return resolved;
}

// --- operations -------------------------------------------------------------

export async function listDatabases(): Promise<RawDatabase[]> {
  const all = await request<RawDatabase[]>('GET', '/databases');
  // `/databases` returns every database type; we only manage Postgres.
  return all.filter((d) => (d.image ?? '').toLowerCase().includes('postgres'));
}

export function getDatabase(uuid: string): Promise<RawDatabase> {
  return request<RawDatabase>('GET', `/databases/${uuid}`);
}

export function createPostgres(input: {
  name: string;
  description?: string;
  image: string;
  isPublic: boolean;
  publicPort: number | null;
}): Promise<{ uuid: string }> {
  const { serverUuid, projectUuid } = requireResolved();
  return request<{ uuid: string }>(
    'POST',
    '/databases/postgresql',
    buildCreatePayload({ ...input, serverUuid, projectUuid }),
  );
}

export function configureDatabase(
  uuid: string,
  input: { isPublic: boolean; publicPort: number | null },
): Promise<unknown> {
  return request('PATCH', `/databases/${uuid}`, buildConfigurePayload(input));
}

export function patchPublicPort(uuid: string, publicPort: number): Promise<unknown> {
  return request('PATCH', `/databases/${uuid}`, { public_port: publicPort });
}

export function startDatabase(uuid: string): Promise<unknown> {
  return request('GET', `/databases/${uuid}/start`);
}

export function stopDatabase(uuid: string): Promise<unknown> {
  return request('GET', `/databases/${uuid}/stop`);
}

export function restartDatabase(uuid: string): Promise<unknown> {
  return request('GET', `/databases/${uuid}/restart`);
}

export function deleteDatabase(uuid: string, deleteVolume: boolean): Promise<unknown> {
  const query = new URLSearchParams({
    delete_volumes: String(deleteVolume),
    delete_configurations: 'true',
    cleanup: 'true',
  });
  return request('DELETE', `/databases/${uuid}?${query.toString()}`);
}

export async function listBackups(uuid: string): Promise<RawBackup[] | null> {
  try {
    return await request<RawBackup[]>('GET', `/databases/${uuid}/backups`);
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

/**
 * Daily 03:00 backup, 14 days retained, to the S3 storage already configured in
 * Coolify. Returns false when the installed version has no such endpoint — the
 * caller turns that into a skipped step, not a failed create.
 */
export async function scheduleDailyBackup(uuid: string): Promise<boolean> {
  if (!env.COOLIFY_S3_STORAGE_UUID) return false;
  try {
    await request('POST', `/databases/${uuid}/backups`, {
      enabled: true,
      frequency: '0 3 * * *',
      save_s3: true,
      s3_storage_uuid: env.COOLIFY_S3_STORAGE_UUID,
      number_of_backups_locally: 14,
    });
    return true;
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) return false;
    throw err;
  }
}

/** Deep link into the Coolify UI for a database. */
export function coolifyDatabaseUrl(uuid: string): string {
  const { projectUuid } = requireResolved();
  return `${env.COOLIFY_URL.replace(/\/$/, '')}/project/${projectUuid}/${env.COOLIFY_ENVIRONMENT}/database/${uuid}`;
}

// --- normalisation ----------------------------------------------------------

export function normaliseDatabase(
  raw: RawDatabase,
  meta: DatabaseMeta | null,
  backupsEnabled: boolean | null = null,
): NormalisedDatabase {
  const image = raw.image ?? env.DEFAULT_PG_IMAGE;
  return {
    uuid: raw.uuid,
    name: raw.name,
    description: raw.description ?? null,
    status: mapStatus(raw.status),
    image,
    version: versionFromImage(image),
    isPublic: Boolean(raw.is_public),
    publicPort: raw.public_port ?? null,
    sslEnabled: Boolean(raw.enable_ssl),
    backupsEnabled,
    createdAt: raw.created_at ?? '',
    meta,
  };
}

export function buildPublicConnectionUrl(raw: RawDatabase): string | null {
  if (!raw.is_public || !raw.public_port) return null;
  const user = raw.postgres_user ?? 'postgres';
  const password = raw.postgres_password ?? '';
  const database = raw.postgres_db ?? raw.name;
  return `postgres://${user}:${password}@${env.PUBLIC_HOST}:${raw.public_port}/${database}?sslmode=require`;
}

export { mapStatus, versionFromImage };
