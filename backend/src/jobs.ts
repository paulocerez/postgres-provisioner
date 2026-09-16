import { randomBytes, randomUUID } from 'node:crypto';
import {
  type CreateDatabaseInput,
  type Job,
  JOB_STEPS,
  type JobStep,
  type JobStepName,
  imageForVersion,
} from '@app/shared';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { writeAudit } from './audit.js';
import {
  CoolifyError,
  createPostgres,
  configureDatabase,
  getDatabase,
  listDatabases,
  patchPublicPort,
  scheduleDailyBackup,
  startDatabase,
} from './coolify.js';
import { db } from './db/client.js';
import { databaseMeta, jobs } from './db/schema.js';
import { env } from './env.js';
import { allocatePort } from './ports.js';

/**
 * Create runs in-process but every step transition is persisted first, so a
 * restart mid-create can tell exactly how far it got. Nothing is ever left
 * stuck in `running` — see `resumeRunningJobs`.
 */

const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HEALTH_POLL_INTERVAL_MS = 3_000;
const HEALTH_POLL_TIMEOUT_MS = 90_000;

export interface JobInput extends CreateDatabaseInput {
  /** The normalised `<name>-db` form actually sent to Coolify. */
  resolvedName: string;
  image: string;
  isPublic: boolean;
  publicPort: number | null;
  /**
   * Generated here because Coolify 4.3.21 accepts a password on create but
   * never returns one. Held in the job row only until the database_meta row is
   * written, then scrubbed — see `scrubJobPassword`.
   */
  password: string;
  actor: string;
}

/**
 * 32 bytes of base64url: no shell-quoting or URL-escaping hazards in a
 * connection string, and far beyond guessing.
 */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

function freshSteps(): JobStep[] {
  return JOB_STEPS.map((name) => ({ name, state: 'pending' }));
}

function parseSteps(raw: string): JobStep[] {
  try {
    const parsed = JSON.parse(raw) as JobStep[];
    return Array.isArray(parsed) ? parsed : freshSteps();
  } catch {
    return freshSteps();
  }
}

function parseInput(raw: string): JobInput {
  return JSON.parse(raw) as JobInput;
}

/** Step transitions are transactional so a crash can never split a write. */
function updateStep(
  jobId: string,
  name: JobStepName,
  patch: Partial<Omit<JobStep, 'name'>>,
): void {
  db.transaction((tx) => {
    const row = tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!row) return;
    const steps = parseSteps(row.steps).map((step) =>
      step.name === name ? { ...step, ...patch, name } : step,
    );
    tx.update(jobs)
      .set({ steps: JSON.stringify(steps), updatedAt: Date.now() })
      .where(eq(jobs.id, jobId))
      .run();
  });
}

function setJobStatus(
  jobId: string,
  status: 'pending' | 'running' | 'done' | 'failed',
  patch: { error?: string | null; resultUuid?: string | null } = {},
): void {
  db.update(jobs)
    .set({ status, updatedAt: Date.now(), ...patch })
    .where(eq(jobs.id, jobId))
    .run();
}

/** Replaces the password in a finished job's stored input with a placeholder. */
function scrubJobPassword(jobId: string): void {
  db.transaction((tx) => {
    const row = tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!row) return;
    const input = parseInput(row.input);
    tx.update(jobs)
      .set({ input: JSON.stringify({ ...input, password: '[stored]' }), updatedAt: Date.now() })
      .where(eq(jobs.id, jobId))
      .run();
  });
}

export function createJob(input: JobInput): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(jobs)
    .values({
      id,
      type: 'create',
      status: 'pending',
      input: JSON.stringify(input),
      steps: JSON.stringify(freshSteps()),
      resultUuid: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function getJob(jobId: string): Job | null {
  const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    steps: parseSteps(row.steps),
    error: row.error,
    result: row.resultUuid ? { uuid: row.resultUuid } : null,
    // The resource exists but a later step failed: "created but not fully
    // configured" rather than a clean failure the operator can ignore.
    partial: row.status === 'failed' && row.resultUuid !== null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the job from the first step that is not yet `done`, so this doubles as
 * the resume path. Never throws: failures are recorded on the job.
 */
export async function runJob(jobId: string): Promise<void> {
  const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row) return;

  const input = parseInput(row.input);
  let steps = parseSteps(row.steps);
  let uuid = row.resultUuid;
  const done = (name: JobStepName) => steps.find((s) => s.name === name)?.state === 'done';
  const skipped = (name: JobStepName) => steps.find((s) => s.name === name)?.state === 'skipped';

  setJobStatus(jobId, 'running', { error: null });

  /** Which step is in flight, so a throw can be attributed to the right one. */
  let current: JobStepName | null = null;

  const step = async <T>(name: JobStepName, fn: () => Promise<T>): Promise<T | undefined> => {
    if (done(name) || skipped(name)) return undefined;
    current = name;
    updateStep(jobId, name, { state: 'running', error: undefined });
    const result = await fn();
    updateStep(jobId, name, { state: 'done' });
    steps = steps.map((s) => (s.name === name ? { ...s, state: 'done' as const } : s));
    current = null;
    return result;
  };

  try {
    // 1. Create the resource, but do not deploy it yet — SSL and the initial
    //    password are only applied when the data directory is first created.
    await step('create', async () => {
      const created = await createPostgres({
        name: input.resolvedName,
        description: input.description,
        image: input.image,
        isPublic: input.isPublic,
        publicPort: input.publicPort,
        password: input.password,
      });
      uuid = created.uuid;
      setJobStatus(jobId, 'running', { resultUuid: uuid });
    });

    if (!uuid) throw new Error('Coolify did not return a uuid for the new database.');
    const resourceUuid = uuid;

    // 2. SSL + public access, before the first start. Also re-check the port:
    //    another create could have taken it between our allocation and now.
    await step('configure', async () => {
      let port = input.publicPort;
      if (port !== null) {
        const existing = await listDatabases();
        const clash = existing.some((d) => d.uuid !== resourceUuid && d.public_port === port);
        if (clash) {
          port = allocatePort(existing.filter((d) => d.uuid !== resourceUuid));
          await patchPublicPort(resourceUuid, port);
          db.update(jobs)
            .set({ input: JSON.stringify({ ...input, publicPort: port }), updatedAt: Date.now() })
            .where(eq(jobs.id, jobId))
            .run();
        }
      }
      await configureDatabase(resourceUuid, { isPublic: input.isPublic, publicPort: port });
    });

    await step('start', () => startDatabase(resourceUuid));

    await step('await-healthy', async () => {
      const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
      for (;;) {
        const current = await getDatabase(resourceUuid);
        if ((current.status ?? '').toLowerCase().startsWith('running')) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `The database did not report "running" within ${HEALTH_POLL_TIMEOUT_MS / 1000}s. It may still be starting — check it in Coolify.`,
          );
        }
        await sleep(HEALTH_POLL_INTERVAL_MS);
      }
    });

    // 5. Backups are optional: an installed Coolify without the endpoint gets a
    //    skipped step and a link in the UI, never a failed create.
    if (!done('backup') && !skipped('backup')) {
      current = 'backup';
      updateStep(jobId, 'backup', { state: 'running' });
      if (!input.backups) {
        updateStep(jobId, 'backup', { state: 'skipped', note: 'Backups were not requested.' });
      } else {
        const scheduled = await scheduleDailyBackup(resourceUuid).catch(() => false);
        updateStep(
          jobId,
          'backup',
          scheduled
            ? { state: 'done' }
            : {
                state: 'skipped',
                note: 'This Coolify version has no backups API (or COOLIFY_S3_STORAGE_UUID is unset) — configure the backup in Coolify.',
              },
        );
      }
      current = null;
    }

    const final = await getDatabase(resourceUuid);
    db.insert(databaseMeta)
      .values({
        coolifyUuid: resourceUuid,
        name: final.name ?? input.resolvedName,
        project: input.project ?? null,
        owner: input.owner ?? null,
        notes: input.notes ?? null,
        postgresPassword: input.password,
        createdBy: input.actor,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    // The password now lives on the meta row; a finished job has no reason to
    // keep a second copy, and jobs are readable through the API.
    scrubJobPassword(jobId);

    setJobStatus(jobId, 'done', { error: null });
    writeAudit({
      actor: input.actor,
      action: 'create',
      targetUuid: resourceUuid,
      targetName: input.resolvedName,
      details: {
        port: input.publicPort,
        image: input.image,
        backups: input.backups,
        // SSL cannot be set through the 4.3.21 API; record what Coolify chose,
        // so a default that changes under us is visible after the fact.
        sslEnabled: Boolean(final.enable_ssl),
      },
    });
  } catch (err) {
    const failing: JobStepName | null = current;
    const message = describe(err);
    if (failing) updateStep(jobId, failing, { state: 'failed', error: message });
    setJobStatus(jobId, 'failed', { error: message });
    writeAudit({
      actor: input.actor,
      action: 'create',
      targetUuid: uuid,
      targetName: input.resolvedName,
      details: { error: message, step: failing ?? null },
    });
  }
}

function describe(err: unknown): string {
  if (err instanceof CoolifyError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Boot recovery. A job left `running` by a restart is re-checked against
 * Coolify: if the resource exists we pick up from the first unfinished step,
 * otherwise the job is failed with a message. It is never left `running`.
 */
export async function resumeRunningJobs(): Promise<void> {
  const stale = db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ['running', 'pending']))
    .all();

  for (const row of stale) {
    const input = parseInput(row.input);
    let uuid = row.resultUuid;

    try {
      if (!uuid) {
        // The create step may have succeeded just before the restart — look the
        // resource up by name rather than creating a duplicate.
        const existing = await listDatabases();
        uuid = existing.find((d) => d.name === input.resolvedName)?.uuid ?? null;
        if (uuid) {
          db.transaction((tx) => {
            const steps = parseSteps(row.steps).map((s) =>
              s.name === 'create' ? { ...s, state: 'done' as const } : s,
            );
            tx.update(jobs)
              .set({ resultUuid: uuid, steps: JSON.stringify(steps), updatedAt: Date.now() })
              .where(eq(jobs.id, row.id))
              .run();
          });
        }
      } else {
        await getDatabase(uuid);
      }
      console.log(`[jobs] resuming job ${row.id} (${input.resolvedName})`);
      void runJob(row.id);
    } catch (err) {
      const message =
        err instanceof CoolifyError && err.status === 404
          ? 'The server restarted during creation and the database no longer exists in Coolify. Nothing was left behind — create it again.'
          : `The server restarted during creation and the job could not be resumed: ${describe(err)}`;
      setJobStatus(row.id, 'failed', { error: message });
      const steps = parseSteps(row.steps).map((s) =>
        s.state === 'running' ? { ...s, state: 'failed' as const, error: message } : s,
      );
      db.update(jobs)
        .set({ steps: JSON.stringify(steps), updatedAt: Date.now() })
        .where(eq(jobs.id, row.id))
        .run();
    }
  }
}

/** Finished jobs are pruned after 7 days; called at startup and hourly. */
export function pruneOldJobs(): number {
  return db
    .delete(jobs)
    .where(
      and(inArray(jobs.status, ['done', 'failed']), lt(jobs.updatedAt, Date.now() - JOB_RETENTION_MS)),
    )
    .run().changes;
}

/** Convenience for the create route: builds the job input from validated form data. */
export function buildJobInput(
  form: CreateDatabaseInput,
  resolvedName: string,
  publicPort: number | null,
  actor: string,
): JobInput {
  return {
    ...form,
    resolvedName,
    image: imageForVersion(form.version) || env.DEFAULT_PG_IMAGE,
    isPublic: form.access === 'public',
    publicPort,
    password: generatePassword(),
    actor,
  };
}
