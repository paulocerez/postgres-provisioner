import {
  type DatabaseDetail,
  type DatabaseList,
  type DatabaseMeta,
  createDatabaseSchema,
  deleteDatabaseSchema,
  metaPatchSchema,
  normaliseDatabaseName,
} from '@app/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { writeAudit } from '../audit.js';
import {
  buildInternalConnectionUrl,
  buildPublicConnectionUrl,
  coolifyDatabaseUrl,
  deleteDatabase,
  getDatabase,
  lastBackupExecution,
  listBackups,
  listDatabases,
  normaliseDatabase,
  restartDatabase,
  startDatabase,
  stopDatabase,
} from '../coolify.js';
import { db } from '../db/client.js';
import { databaseMeta } from '../db/schema.js';
import { buildJobInput, createJob, runJob } from '../jobs.js';
import { asyncHandler, param } from '../middleware.js';
import { allocatePort } from '../ports.js';

export const databasesRouter: Router = Router();

function metaByUuid(): Map<string, DatabaseMeta & { name: string; createdAt: number }> {
  const rows = db.select().from(databaseMeta).all();
  return new Map(
    rows.map((row) => [
      row.coolifyUuid,
      {
        project: row.project,
        owner: row.owner,
        notes: row.notes,
        name: row.name,
        createdAt: row.createdAt,
      },
    ]),
  );
}

function actorOf(req: { session?: { email: string } }): string {
  return req.session?.email ?? 'unknown';
}

/** List, joined with local meta. Meta rows with no Coolify resource are orphans. */
databasesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const raw = await listDatabases();
    const meta = metaByUuid();
    const liveUuids = new Set(raw.map((d) => d.uuid));

    const body: DatabaseList = {
      databases: raw.map((database) => {
        const row = meta.get(database.uuid);
        return normaliseDatabase(
          database,
          row ? { project: row.project, owner: row.owner, notes: row.notes } : null,
        );
      }),
      orphaned: [...meta.entries()]
        .filter(([uuid]) => !liveUuids.has(uuid))
        .map(([uuid, row]) => ({
          coolifyUuid: uuid,
          name: row.name,
          project: row.project,
          owner: row.owner,
          notes: row.notes,
          createdAt: row.createdAt,
        })),
    };

    res.json(body);
  }),
);

/** Detail, including the generated password. Never cached (see `noStore`). */
databasesRouter.get(
  '/:uuid',
  asyncHandler(async (req, res) => {
    const uuid = param(req, 'uuid');
    const raw = await getDatabase(uuid);
    const row = db.select().from(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).get();

    const backups = await listBackups(uuid).catch(() => null);
    const schedule = backups?.[0] ?? null;
    const lastRun =
      schedule?.uuid !== undefined ? await lastBackupExecution(uuid, schedule.uuid) : null;

    // Coolify 4.3.21 never discloses a password, so the only one we can show is
    // the one we generated at create time.
    const password = row?.postgresPassword ?? null;

    const body: DatabaseDetail = {
      ...normaliseDatabase(
        raw,
        row ? { project: row.project, owner: row.owner, notes: row.notes } : null,
        backups === null ? null : Boolean(schedule?.enabled),
      ),
      internalUrl: buildInternalConnectionUrl(raw, password),
      publicUrl: buildPublicConnectionUrl(raw, password),
      postgresUser: raw.postgres_user ?? null,
      postgresDb: raw.postgres_db ?? null,
      postgresPassword: password,
      coolifyUrl: coolifyDatabaseUrl(uuid),
      backup: schedule
        ? {
            enabled: Boolean(schedule.enabled),
            frequency: schedule.frequency ?? null,
            lastRunAt: lastRun?.created_at ?? null,
            lastRunStatus: lastRun?.status ?? null,
          }
        : null,
    };

    res.json(body);
  }),
);

/** Create. Returns a job id immediately; the client polls /api/jobs/:jobId. */
databasesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const form = createDatabaseSchema.parse(req.body);
    const resolvedName = normaliseDatabaseName(form.name);

    const existing = await listDatabases();
    const clash = existing.some((d) => (d.name ?? '').toLowerCase() === resolvedName);
    if (clash) {
      res.status(409).json({
        error: { message: `A database named "${resolvedName}" already exists.` },
      });
      return;
    }

    // Throws PortRangeExhaustedError (409) rather than creating something
    // unreachable — the firewall only opens the configured range.
    const publicPort = form.access === 'public' ? allocatePort(existing) : null;

    const jobId = createJob(buildJobInput(form, resolvedName, publicPort, actorOf(req)));
    void runJob(jobId);

    res.status(202).json({ jobId });
  }),
);

function lifecycle(
  action: 'start' | 'stop' | 'restart',
  call: (uuid: string) => Promise<unknown>,
) {
  return asyncHandler(async (req, res) => {
    const uuid = param(req, 'uuid');
    const row = db.select().from(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).get();
    try {
      await call(uuid);
    } catch (err) {
      writeAudit({
        actor: actorOf(req),
        action,
        targetUuid: uuid,
        targetName: row?.name ?? null,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
    writeAudit({
      actor: actorOf(req),
      action,
      targetUuid: uuid,
      targetName: row?.name ?? null,
    });
    res.json({ ok: true });
  });
}

databasesRouter.post('/:uuid/start', lifecycle('start', startDatabase));
databasesRouter.post('/:uuid/stop', lifecycle('stop', stopDatabase));
databasesRouter.post('/:uuid/restart', lifecycle('restart', restartDatabase));

/**
 * Delete. The typed name must match, and volume deletion is a separate opt-in
 * that defaults to keeping the data.
 */
databasesRouter.delete(
  '/:uuid',
  asyncHandler(async (req, res) => {
    const uuid = param(req, 'uuid');
    const { confirmName, deleteVolume } = deleteDatabaseSchema.parse(req.body);

    const raw = await getDatabase(uuid);
    if ((raw.name ?? '') !== confirmName) {
      res.status(400).json({
        error: { message: 'The typed name does not match this database. Nothing was deleted.' },
      });
      return;
    }

    await deleteDatabase(uuid, deleteVolume);
    db.delete(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).run();

    writeAudit({
      actor: actorOf(req),
      action: 'delete',
      targetUuid: uuid,
      targetName: raw.name ?? null,
      details: { deleteVolume },
    });
    res.json({ ok: true });
  }),
);

/** Local-only metadata. Never reaches Coolify. */
databasesRouter.patch('/:uuid/meta', (req, res) => {
  const uuid = param(req, 'uuid');
  const patch = metaPatchSchema.parse(req.body);
  const existing = db.select().from(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).get();

  if (existing) {
    db.update(databaseMeta)
      .set({
        project: patch.project === undefined ? existing.project : patch.project,
        owner: patch.owner === undefined ? existing.owner : patch.owner,
        notes: patch.notes === undefined ? existing.notes : patch.notes,
      })
      .where(eq(databaseMeta.coolifyUuid, uuid))
      .run();
  } else {
    db.insert(databaseMeta)
      .values({
        coolifyUuid: uuid,
        name: typeof req.body?.name === 'string' ? req.body.name : uuid,
        project: patch.project ?? null,
        owner: patch.owner ?? null,
        notes: patch.notes ?? null,
        createdBy: actorOf(req),
        createdAt: Date.now(),
      })
      .run();
  }

  writeAudit({
    actor: actorOf(req),
    action: 'meta_update',
    targetUuid: uuid,
    targetName: existing?.name ?? null,
  });
  res.json({ ok: true });
});

/**
 * Clears an orphaned meta row. Deliberately local-only: a missing meta row must
 * never cause a Coolify resource to be deleted.
 */
databasesRouter.delete('/:uuid/meta', (req, res) => {
  const uuid = param(req, 'uuid');
  const existing = db.select().from(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).get();
  db.delete(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).run();
  writeAudit({
    actor: actorOf(req),
    action: 'meta_remove',
    targetUuid: uuid,
    targetName: existing?.name ?? null,
  });
  res.json({ ok: true });
});
