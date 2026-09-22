import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Local state only. Coolify stays the source of truth for the *state* of each
 * database — nothing here caches a container status.
 */

export const sessions = sqliteTable('sessions', {
  /** sha256 of the cookie value; the raw id only ever lives in the cookie. */
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull().$type<'create'>(),
  status: text('status')
    .notNull()
    .$type<'pending' | 'running' | 'paused' | 'done' | 'failed'>(),
  /** JSON: the validated CreateDatabaseInput plus the allocated port. */
  input: text('input').notNull(),
  /** JSON: JobStep[] — see shared/schemas.ts. */
  steps: text('steps').notNull(),
  resultUuid: text('result_uuid'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const databaseMeta = sqliteTable('database_meta', {
  coolifyUuid: text('coolify_uuid').primaryKey(),
  name: text('name').notNull(),
  project: text('project'),
  owner: text('owner'),
  notes: text('notes'),
  /**
   * The password we generated at create time. Coolify 4.3.21 accepts a password
   * on create but never discloses one afterwards, so this is the only copy —
   * without it the details page cannot show a connection string that works.
   * Null for databases created outside this app; theirs is unrecoverable.
   */
  postgresPassword: text('postgres_password'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * Sources allowed to reach a database's public port. This is the desired state;
 * `firewall.ts` reconciles it into real Hetzner rules, so a row here is a claim
 * about what should be open, never a record of what is.
 */
export const databaseAllowlist = sqliteTable(
  'database_allowlist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    coolifyUuid: text('coolify_uuid').notNull(),
    /** Normalised CIDR — see `parseCidr` in shared/schemas.ts. */
    cidr: text('cidr').notNull(),
    label: text('label'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    uuidIdx: index('database_allowlist_uuid_idx').on(table.coolifyUuid),
    uniqueCidr: uniqueIndex('database_allowlist_uuid_cidr_idx').on(table.coolifyUuid, table.cidr),
  }),
);

/**
 * Which project holds a connection string to which database.
 *
 * This is a record of a push that happened, not desired state — unlike
 * `database_allowlist`, nothing reconciles it. Vercel stores the variable as
 * `sensitive`, meaning it is write-only there and cannot be read back, so this
 * table is the only account of what was sent where. A row going stale (someone
 * deletes the variable in the dashboard) is possible and not detectable; the UI
 * says when the row was written rather than implying it is still in force.
 */
export const databaseLinks = sqliteTable(
  'database_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    coolifyUuid: text('coolify_uuid').notNull(),
    /** Only 'vercel' today; the column exists so Render does not need a table. */
    platform: text('platform').notNull().$type<'vercel'>(),
    projectId: text('project_id').notNull(),
    /** Snapshot for display — a project renamed on Vercel should not orphan the row. */
    projectName: text('project_name').notNull(),
    envKey: text('env_key').notNull(),
    /** JSON string[] of Vercel targets the variable was written to. */
    targets: text('targets').notNull(),
    /** Which connection string was sent: 'gateway' or 'public'. */
    urlKind: text('url_kind').notNull().$type<'gateway' | 'public'>(),
    linkedBy: text('linked_by').notNull(),
    linkedAt: integer('linked_at').notNull(),
  },
  (table) => ({
    uuidIdx: index('database_links_uuid_idx').on(table.coolifyUuid),
    uniqueTarget: uniqueIndex('database_links_uuid_project_key_idx').on(
      table.coolifyUuid,
      table.platform,
      table.projectId,
      table.envKey,
    ),
  }),
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetUuid: text('target_uuid'),
    targetName: text('target_name'),
    /** JSON, always passed through `redact()` before it is written. */
    details: text('details'),
  },
  (table) => ({
    atIdx: index('audit_log_at_idx').on(sql`${table.at} desc`),
  }),
);

export type SessionRow = typeof sessions.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type DatabaseMetaRow = typeof databaseMeta.$inferSelect;
export type DatabaseAllowlistRow = typeof databaseAllowlist.$inferSelect;
export type DatabaseLinkRow = typeof databaseLinks.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
