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
export type AuditLogRow = typeof auditLog.$inferSelect;
