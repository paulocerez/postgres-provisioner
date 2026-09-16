import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
export type AuditLogRow = typeof auditLog.$inferSelect;
