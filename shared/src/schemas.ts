import { z } from 'zod';

/**
 * Shared contract between the Express API and the React client.
 * Both sides validate with these; the rules are written exactly once.
 */

export const PG_VERSIONS = ['18', '17', '16'] as const;
export const DB_NAME_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Coolify's container status, normalised. */
export const databaseStatusSchema = z.enum([
  'running',
  'stopped',
  'exited',
  'starting',
  'unknown',
]);
export type DatabaseStatus = z.infer<typeof databaseStatusSchema>;

export const databaseMetaSchema = z.object({
  project: z.string().nullable(),
  owner: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DatabaseMeta = z.infer<typeof databaseMetaSchema>;

/** The normalised database shape the client sees (spec section 6). */
export const databaseSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: databaseStatusSchema,
  image: z.string(),
  version: z.string(),
  isPublic: z.boolean(),
  publicPort: z.number().nullable(),
  sslEnabled: z.boolean(),
  /** null = the installed Coolify has no backups endpoint, so we cannot know. */
  backupsEnabled: z.boolean().nullable(),
  createdAt: z.string(),
  meta: databaseMetaSchema.nullable(),
});
export type Database = z.infer<typeof databaseSchema>;

/**
 * A `databaseMeta` row whose uuid no longer exists in Coolify. Surfaced so the
 * operator can clear it; removing one never touches a Coolify resource.
 */
export const orphanedMetaSchema = z.object({
  coolifyUuid: z.string(),
  name: z.string(),
  project: z.string().nullable(),
  owner: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.number(),
});
export type OrphanedMeta = z.infer<typeof orphanedMetaSchema>;

export const databaseListSchema = z.object({
  databases: z.array(databaseSchema),
  orphaned: z.array(orphanedMetaSchema),
});
export type DatabaseList = z.infer<typeof databaseListSchema>;

/** Full detail, only served by GET /api/databases/:uuid (contains the password). */
export const databaseDetailSchema = databaseSchema.extend({
  internalUrl: z.string().nullable(),
  publicUrl: z.string().nullable(),
  postgresUser: z.string().nullable(),
  postgresDb: z.string().nullable(),
  postgresPassword: z.string().nullable(),
  coolifyUrl: z.string().nullable(),
  backup: z
    .object({
      enabled: z.boolean(),
      frequency: z.string().nullable(),
      lastRunAt: z.string().nullable(),
      lastRunStatus: z.string().nullable(),
    })
    .nullable(),
});
export type DatabaseDetail = z.infer<typeof databaseDetailSchema>;

/**
 * Create form body. `name` is normalised (lowercased, `-db` suffix added) on
 * both sides via `normaliseDatabaseName` before it is compared or submitted.
 */
export const createDatabaseSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      DB_NAME_PATTERN,
      'Use 3-40 characters: lowercase letters, numbers and hyphens only.',
    ),
  description: z.string().trim().max(200, 'Keep it under 200 characters.').optional(),
  version: z.enum(PG_VERSIONS),
  access: z.enum(['public', 'internal']),
  backups: z.boolean(),
  project: z.string().trim().max(100).optional(),
  owner: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

export const metaPatchSchema = z.object({
  project: z.string().trim().max(100).nullable().optional(),
  owner: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type MetaPatchInput = z.infer<typeof metaPatchSchema>;

export const deleteDatabaseSchema = z.object({
  confirmName: z.string(),
  deleteVolume: z.boolean(),
});
export type DeleteDatabaseInput = z.infer<typeof deleteDatabaseSchema>;

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Create-job progress (spec section 6). Steps are fixed and ordered. */
export const JOB_STEPS = [
  'create',
  'configure',
  'start',
  'await-healthy',
  'backup',
] as const;
export type JobStepName = (typeof JOB_STEPS)[number];

export const JOB_STEP_LABELS: Record<JobStepName, string> = {
  create: 'Creating',
  configure: 'Configuring SSL/access',
  start: 'Starting',
  'await-healthy': 'Waiting for healthy',
  backup: 'Scheduling backup',
};

export const jobStepSchema = z.object({
  name: z.enum(JOB_STEPS),
  state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  error: z.string().optional(),
  note: z.string().optional(),
});
export type JobStep = z.infer<typeof jobStepSchema>;

export const jobSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  steps: z.array(jobStepSchema),
  error: z.string().nullable(),
  result: z.object({ uuid: z.string() }).nullable(),
  /**
   * True when the Coolify resource exists but a later step failed — the UI says
   * "created but not fully configured" rather than pretending nothing happened.
   */
  partial: z.boolean(),
});
export type Job = z.infer<typeof jobSchema>;

export const metaResponseSchema = z.object({
  coolifyVersion: z.string().nullable(),
  coolifyUrl: z.string(),
  projectName: z.string().nullable(),
  projectUuid: z.string().nullable(),
  environment: z.string(),
  publicHost: z.string(),
  portRange: z.object({ start: z.number(), end: z.number() }),
  backupsSupported: z.boolean(),
  defaultImage: z.string(),
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

export const auditActionSchema = z.enum([
  'create',
  'start',
  'stop',
  'restart',
  'delete',
  'login',
  'login_failed',
  'meta_update',
  'meta_remove',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  id: z.number(),
  at: z.number(),
  actor: z.string(),
  action: auditActionSchema,
  targetUuid: z.string().nullable(),
  targetName: z.string().nullable(),
  details: z.record(z.unknown()).nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const sessionSchema = z.object({ email: z.string() });
export type Session = z.infer<typeof sessionSchema>;

/** Error envelope returned by every /api route. */
export const apiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    step: z.string().optional(),
    coolifyStatus: z.number().optional(),
  }),
});

/**
 * The spec wants every database named `<something>-db`. Applied identically on
 * the client (so the user sees what will be created) and on the server.
 */
export function normaliseDatabaseName(raw: string): string {
  const name = raw.trim().toLowerCase();
  return name.endsWith('-db') ? name : `${name}-db`;
}

export function imageForVersion(version: string): string {
  return `postgres:${version}-alpine`;
}
