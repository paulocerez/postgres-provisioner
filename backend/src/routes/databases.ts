import {
  type AllowlistEntry,
  type DatabaseDetail,
  type DatabaseList,
  type DatabaseMeta,
  allowlistPutSchema,
  createDatabaseSchema,
  deleteDatabaseSchema,
  isOpenToWorld,
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
import { databaseAllowlist, databaseMeta } from '../db/schema.js';
import { firewallManaged } from '../env.js';
import { findConflictingRule, readFirewallRules, reconcileFirewall } from '../firewall.js';
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

function allowlistOf(uuid: string): AllowlistEntry[] {
  return db
    .select()
    .from(databaseAllowlist)
    .where(eq(databaseAllowlist.coolifyUuid, uuid))
    .all()
    .map((row) => ({ cidr: row.cidr, label: row.label }))
    .sort((a, b) => a.cidr.localeCompare(b.cidr));
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

    // A firewall that cannot be read must not take the page down with it — the
    // allowlist section degrades, exactly as the backup section does.
    const rules = await readFirewallRules().catch(() => null);

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
      coolifyUrl: coolifyDatabaseUrl(uuid, raw.environment?.uuid),
      backup: schedule
        ? {
            enabled: Boolean(schedule.enabled),
            frequency: schedule.frequency ?? null,
            lastRunAt: lastRun?.created_at ?? null,
            lastRunStatus: lastRun?.status ?? null,
          }
        : null,
      allowlist: allowlistOf(uuid),
      firewall: {
        managed: firewallManaged,
        reachable: rules !== null,
        conflictingRule:
          rules && raw.public_port ? findConflictingRule(rules, raw.public_port) : null,
      },
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
    db.delete(databaseAllowlist).where(eq(databaseAllowlist.coolifyUuid, uuid)).run();

    // Best effort: the database is already gone, so a firewall that cannot be
    // reached must not turn a successful delete into an error. The stale rule is
    // harmless (nothing listens on the port) and the next save clears it.
    await reconcileFirewall().catch((err: unknown) => {
      console.error('[firewall] could not clear rules after delete:', err);
    });

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

/**
 * Replaces the whole allowlist for one database and applies it to the firewall.
 *
 * The local rows are written first because the desired rule set is derived from
 * them, but if Hetzner then refuses the change the previous rows are restored:
 * the table must never claim access that the firewall does not actually grant.
 */
databasesRouter.put(
  '/:uuid/allowlist',
  asyncHandler(async (req, res) => {
    const uuid = param(req, 'uuid');
    if (!firewallManaged) {
      res.status(409).json({
        error: {
          message:
            'This deployment does not manage a firewall. Set HCLOUD_TOKEN and HCLOUD_FIREWALL_ID to enable allowlists.',
        },
      });
      return;
    }

    const { entries } = allowlistPutSchema.parse(req.body);

    /*
     * `/0` is a legal range and Hetzner accepts it, so nothing upstream of here
     * stops an operator reaching for it when an allowlist cannot express their
     * client's addresses — which is exactly the case for serverless egress.
     *
     * On a database without SSL that is not merely wide, it is disclosing: the
     * connection string this app hands out says `sslmode=disable`, honestly,
     * because Coolify 4.3.21 creates databases with SSL off and exposes no way
     * to turn it on afterwards. Opening that to the internet puts the superuser
     * password on the wire in clear text. Refuse this one combination by name;
     * every other width stays the operator's call.
     */
    const openToWorld = entries.filter((entry) => isOpenToWorld(entry.cidr));
    if (openToWorld.length > 0) {
      const target = await getDatabase(uuid);
      if (!target.enable_ssl) {
        res.status(409).json({
          error: {
            message: `${openToWorld
              .map((entry) => entry.cidr)
              .join(' and ')} would open this database to every host on the internet, and SSL is not enabled on it — the password would cross the network in clear text. Enable SSL on the database in Coolify, or allow specific addresses instead.`,
          },
        });
        return;
      }
    }

    const row = db.select().from(databaseMeta).where(eq(databaseMeta.coolifyUuid, uuid)).get();
    const snapshot = db
      .select()
      .from(databaseAllowlist)
      .where(eq(databaseAllowlist.coolifyUuid, uuid))
      .all();

    const actor = actorOf(req);
    const now = Date.now();
    const replace = (rows: (typeof databaseAllowlist.$inferInsert)[]) => {
      db.transaction((tx) => {
        tx.delete(databaseAllowlist).where(eq(databaseAllowlist.coolifyUuid, uuid)).run();
        if (rows.length > 0) tx.insert(databaseAllowlist).values(rows).run();
      });
    };

    replace(
      entries.map((entry) => ({
        coolifyUuid: uuid,
        cidr: entry.cidr,
        label: entry.label,
        createdBy: actor,
        createdAt: now,
      })),
    );

    try {
      await reconcileFirewall();
    } catch (err) {
      replace(snapshot.map(({ id: _id, ...rest }) => rest));
      writeAudit({
        actor,
        action: 'allowlist_update',
        targetUuid: uuid,
        targetName: row?.name ?? null,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }

    // `cidrs` deliberately, not `sources` or anything url-shaped: `redact()`
    // blanks any key matching /password|token|url|…/i.
    writeAudit({
      actor,
      action: 'allowlist_update',
      targetUuid: uuid,
      targetName: row?.name ?? null,
      details: { cidrs: entries.map((entry) => entry.cidr) },
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
