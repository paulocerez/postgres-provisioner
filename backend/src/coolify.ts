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
 * disagrees, that block is the only thing to edit — run `GET /api/v1/databases`
 * with a real token and diff the keys, and check `openapi.json` at the matching
 * tag in coollabsio/coolify for the request bodies.
 */

// ---------------------------------------------------------------------------
// --- COOLIFY FIELD MAP -----------------------------------------------------
// Verified against Coolify 4.3.21: live GET /databases on the Hetzner box plus
// openapi.json at tag v4.3.21. Three things about this version drive the design:
//
//   1. SSL is not in the API at all — no `enable_ssl` or `ssl_mode` on create or
//      PATCH. It is readable on the resource and Coolify defaults it on. We read
//      it back and warn; we cannot set it.
//   2. The password is never disclosed by any endpoint, but IS accepted on
//      create. We generate it, send it, and store it — see jobs.ts.
//   3. Lifecycle is POST, not GET, and create needs `environment_uuid` as well
//      as `environment_name`.
// ---------------------------------------------------------------------------

/** A Postgres resource as returned by `GET /databases` and `GET /databases/{uuid}`. */
export interface RawDatabase {
  uuid: string;
  name: string;
  description?: string | null;
  /** 'running:healthy', 'exited', 'restarting', 'degraded' ... */
  status?: string | null;
  image?: string | null;
  /** 'standalone-postgresql', 'standalone-redis', ... */
  database_type?: string | null;
  is_public?: boolean | null;
  public_port?: number | null;
  /** Read-only in 4.3.21: present on the resource, absent from every request body. */
  enable_ssl?: boolean | null;
  ssl_mode?: string | null;
  postgres_user?: string | null;
  postgres_db?: string | null;
  created_at?: string | null;
  destination?: { name?: string; uuid?: string } | null;
  environment?: { name?: string; uuid?: string } | null;
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
}

interface RawBackupExecution {
  created_at?: string | null;
  status?: string | null;
}

/**
 * Body for `POST /databases/postgresql`.
 *
 * `postgres_password` is ours to choose: 4.3.21 accepts it here and never gives
 * it back from any read endpoint, so generating it is the only way to end up
 * with a connection string that works.
 */
function buildCreatePayload(input: {
  name: string;
  description?: string;
  image: string;
  isPublic: boolean;
  publicPort: number | null;
  password: string;
  serverUuid: string;
  projectUuid: string;
  environmentUuid: string;
}): Record<string, unknown> {
  return {
    server_uuid: input.serverUuid,
    project_uuid: input.projectUuid,
    // Both are required by the 4.3.21 schema, not one or the other.
    environment_name: env.COOLIFY_ENVIRONMENT,
    environment_uuid: input.environmentUuid,
    name: input.name,
    description: input.description ?? '',
    image: input.image,
    postgres_user: 'postgres',
    postgres_password: input.password,
    postgres_db: postgresDbName(input.name),
    is_public: input.isPublic,
    ...(input.publicPort !== null ? { public_port: input.publicPort } : {}),
    instant_deploy: false,
  };
}

/**
 * Body for the pre-start `PATCH /databases/{uuid}`. Public access only — SSL is
 * not settable in this version (see the note at the top of the field map).
 */
function buildConfigurePayload(input: {
  isPublic: boolean;
  publicPort: number | null;
}): Record<string, unknown> {
  return {
    is_public: input.isPublic,
    ...(input.publicPort !== null ? { public_port: input.publicPort } : {}),
  };
}

/** Body for `POST /databases/{uuid}/backups`. */
function buildBackupPayload(s3StorageUuid: string): Record<string, unknown> {
  return {
    frequency: '0 3 * * *',
    enabled: true,
    save_s3: true,
    s3_storage_uuid: s3StorageUuid,
    database_backup_retention_amount_s3: 14,
    database_backup_retention_amount_locally: 14,
    // One immediate run, so a broken backup config is discovered now rather
    // than at 03:00 on the day it is needed.
    backup_now: true,
  };
}

/** Postgres rejects hyphens in unquoted identifiers, so `demo-db` → `demo_db`. */
function postgresDbName(name: string): string {
  return name.replace(/-/g, '_');
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

/** Only Postgres resources; `/databases` returns every engine Coolify manages. */
function isPostgres(raw: RawDatabase): boolean {
  const type = (raw.database_type ?? '').toLowerCase();
  if (type) return type.includes('postgres');
  return (raw.image ?? '').toLowerCase().includes('postgres');
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
    // `/version` answers with a bare `4.3.21`, which is not valid JSON. Hand the
    // raw text back and let the caller decide; anything else is a real error.
    if (endpoint === '/version') return text.trim() as T;
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
  /** Required by `POST /databases/postgresql` in 4.3.21, alongside the name. */
  environmentUuid: string;
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

  // The environment uuid only appears on the single-project endpoint, and
  // creates are rejected without it.
  const project = await request<RawProject>('GET', `/projects/${projectUuid}`);
  const environments = project.environments ?? [];
  const environment =
    environments.find((e) => e.name === env.COOLIFY_ENVIRONMENT) ?? environments[0];
  if (!environment) {
    throw new CoolifyError(
      0,
      `/projects/${projectUuid}`,
      '',
      `Project "${projectName ?? projectUuid}" has no environment named "${env.COOLIFY_ENVIRONMENT}".`,
    );
  }

  const backupsSupported = await probeBackupsSupport();

  resolved = {
    version,
    serverUuid,
    projectUuid,
    projectName,
    environmentUuid: environment.uuid,
    backupsSupported,
  };
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
  return all.filter(isPostgres);
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
  password: string;
}): Promise<{ uuid: string }> {
  const { serverUuid, projectUuid, environmentUuid } = requireResolved();
  return request<{ uuid: string }>(
    'POST',
    '/databases/postgresql',
    buildCreatePayload({ ...input, serverUuid, projectUuid, environmentUuid }),
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

// Lifecycle is POST in 4.3.21 — a GET here answers 405.
export function startDatabase(uuid: string): Promise<unknown> {
  return request('POST', `/databases/${uuid}/start`);
}

export function stopDatabase(uuid: string): Promise<unknown> {
  return request('POST', `/databases/${uuid}/stop`);
}

export function restartDatabase(uuid: string): Promise<unknown> {
  return request('POST', `/databases/${uuid}/restart`);
}

export function deleteDatabase(uuid: string, deleteVolume: boolean): Promise<unknown> {
  const query = new URLSearchParams({
    // Every one of these defaults to true, so the volume must be passed
    // explicitly — omitting it would destroy the data.
    delete_volumes: String(deleteVolume),
    delete_configurations: 'true',
    docker_cleanup: 'true',
    delete_connected_networks: 'true',
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
    await request('POST', `/databases/${uuid}/backups`, buildBackupPayload(env.COOLIFY_S3_STORAGE_UUID));
    return true;
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) return false;
    throw err;
  }
}

/** Last execution of a schedule, for the details page. */
export async function lastBackupExecution(
  uuid: string,
  scheduleUuid: string,
): Promise<RawBackupExecution | null> {
  try {
    const executions = await request<RawBackupExecution[]>(
      'GET',
      `/databases/${uuid}/backups/${scheduleUuid}/executions`,
    );
    return executions[0] ?? null;
  } catch {
    // Missing execution history is not worth failing the details page over.
    return null;
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

/**
 * Connection strings are assembled here rather than read from Coolify, which
 * discloses neither the password nor a URL in 4.3.21. `password` is the one we
 * generated at create time; it is null for databases created outside this app
 * (their password is unrecoverable), and the UI says so rather than handing out
 * a string that cannot work.
 */
export function buildPublicConnectionUrl(
  raw: RawDatabase,
  password: string | null,
): string | null {
  if (!raw.is_public || !raw.public_port || !password) return null;
  const user = raw.postgres_user ?? 'postgres';
  const database = raw.postgres_db ?? postgresDbName(raw.name);
  // `sslmode=require` against a server without SSL fails to connect, so the
  // string has to describe the database as it actually is — the UI warns
  // separately when SSL is off.
  const sslMode = raw.enable_ssl ? 'require' : 'disable';
  return `postgres://${user}:${password}@${env.PUBLIC_HOST}:${raw.public_port}/${database}?sslmode=${sslMode}`;
}

/**
 * Reachable from other containers on the Coolify network. Coolify names
 * database containers after their uuid, so that is the host.
 */
export function buildInternalConnectionUrl(
  raw: RawDatabase,
  password: string | null,
): string | null {
  if (!password) return null;
  const user = raw.postgres_user ?? 'postgres';
  const database = raw.postgres_db ?? postgresDbName(raw.name);
  return `postgres://${user}:${password}@${raw.uuid}:5432/${database}`;
}

export { mapStatus, versionFromImage, isPostgres, postgresDbName };
