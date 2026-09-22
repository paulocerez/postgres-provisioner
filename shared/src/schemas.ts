import { z } from 'zod';

/**
 * Shared contract between the Express API and the React client.
 * Both sides validate with these; the rules are written exactly once.
 */

export const PG_VERSIONS = ['18', '17', '16'] as const;
export const DB_NAME_PATTERN = /^[a-z0-9-]{3,40}$/;

/**
 * How many sources one database may allow. Hetzner caps a firewall at 50 rules
 * and 100 source IPs per rule; this is the far smaller limit that keeps the card
 * readable, and it is the one the operator will actually meet first.
 */
export const MAX_ALLOWLIST_ENTRIES = 20;

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

// --- firewall allowlist ------------------------------------------------------

/**
 * Hetzner accepts source IPs in CIDR notation only, and rejects a range whose
 * host bits are set (`203.0.113.4/24` is an error, not a silent mask). Both
 * rules are checked here so the operator is told which address they meant
 * instead of meeting a 422 from an API they never called.
 */
export type CidrParse = { ok: true; value: string } | { ok: false; message: string };

export function parseCidr(raw: string): CidrParse {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return { ok: false, message: 'Enter an address, e.g. 203.0.113.4/32.' };

  const slash = value.indexOf('/');
  if (slash === -1) {
    return {
      ok: false,
      message: value.includes(':')
        ? 'Add a prefix length — use /128 for a single IPv6 address.'
        : 'Add a prefix length — use /32 for a single IPv4 address.',
    };
  }

  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) {
    return { ok: false, message: 'The prefix length must be a number, e.g. /32.' };
  }
  const prefix = Number(prefixText);

  return address.includes(':')
    ? parseIpv6Cidr(address, prefix)
    : parseIpv4Cidr(address, prefix);
}

function parseIpv4Cidr(address: string, prefix: number): CidrParse {
  if (prefix > 32) return { ok: false, message: 'An IPv4 prefix must be between /0 and /32.' };

  const octets = address.split('.');
  if (octets.length !== 4) {
    return { ok: false, message: 'Not a valid IPv4 address — expected four parts, e.g. 203.0.113.4.' };
  }

  const numbers: number[] = [];
  for (const octet of octets) {
    // Leading zeros are rejected rather than guessed at: `010` is 8 to some
    // parsers and 10 to others, and an allowlist is the wrong place to be vague.
    if (!/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255) {
      return { ok: false, message: `"${octet}" is not a valid part of an IPv4 address.` };
    }
    numbers.push(Number(octet));
  }

  const bits = numbers.reduce((acc, n) => acc * 256 + n, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (bits & mask) >>> 0;
  if (network !== bits) {
    const suggestion = [24, 16, 8, 0].map((shift) => (network >>> shift) & 0xff).join('.');
    return {
      ok: false,
      message: `Host bits must be zero for a /${prefix}. Did you mean ${suggestion}/${prefix}, or ${address}/32 for just this address?`,
    };
  }

  return { ok: true, value: `${numbers.join('.')}/${prefix}` };
}

function parseIpv6Cidr(address: string, prefix: number): CidrParse {
  if (prefix > 128) return { ok: false, message: 'An IPv6 prefix must be between /0 and /128.' };

  const halves = address.split('::');
  if (halves.length > 2) {
    return { ok: false, message: 'An IPv6 address may contain "::" at most once.' };
  }

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? head.length + tail.length : head.length;
  if (halves.length === 1 ? groups !== 8 : groups > 7) {
    return { ok: false, message: 'Not a valid IPv6 address.' };
  }

  const parts = [...head, ...new Array(8 - groups).fill('0'), ...tail];
  const words: number[] = [];
  for (const part of parts) {
    // An embedded IPv4 tail (::ffff:1.2.3.4) is deliberately unsupported —
    // write it as the IPv4 range instead.
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return { ok: false, message: `"${part}" is not a valid group of an IPv6 address.` };
    }
    words.push(Number.parseInt(part, 16));
  }

  let remaining = prefix;
  const network = words.map((word) => {
    const take = Math.min(16, Math.max(0, remaining));
    remaining -= take;
    const mask = take === 0 ? 0 : (0xffff << (16 - take)) & 0xffff;
    return word & mask;
  });
  if (network.some((word, i) => word !== words[i])) {
    const suggestion = compressIpv6(network);
    return {
      ok: false,
      message: `Host bits must be zero for a /${prefix}. Did you mean ${suggestion}/${prefix}, or ${address}/128 for just this address?`,
    };
  }

  return { ok: true, value: `${compressIpv6(words)}/${prefix}` };
}

/**
 * RFC 5952 canonical form: lowercase, no leading zeros, and the longest run of
 * zero groups collapsed to `::` (leftmost wins a tie, and a single zero group is
 * never collapsed).
 *
 * This has to match Hetzner byte for byte. `canonical()` in the backend's
 * firewall reconciler compares the rules it wants against the rules Hetzner
 * reports as plain strings, and Hetzner reports the compressed form. Emitting
 * the expanded one here would make that comparison never hold, so every
 * reconcile would rewrite the firewall forever.
 */
function compressIpv6(words: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let i = 0; i <= words.length; i += 1) {
    if (i < words.length && words[i] === 0) {
      if (start === -1) start = i;
      continue;
    }
    if (start !== -1) {
      const length = i - start;
      // Strictly greater keeps the leftmost run when two are the same length.
      if (length > bestLength) {
        bestStart = start;
        bestLength = length;
      }
      start = -1;
    }
  }

  const groups = words.map((word) => word.toString(16));
  if (bestLength < 2) return groups.join(':');

  const head = groups.slice(0, bestStart).join(':');
  const tail = groups.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/**
 * Whether a source allows the entire internet. `parseCidr` accepts `/0` — it is
 * a legal range and Hetzner takes it — so nothing upstream of this will stop an
 * operator typing it. The UI and the API use this to make that a deliberate act
 * rather than a typo.
 */
export function isOpenToWorld(cidr: string): boolean {
  const parsed = parseCidr(cidr);
  const value = parsed.ok ? parsed.value : cidr.trim();
  return value.endsWith('/0');
}

/** Normalised on both sides, so the stored value is the one Hetzner is sent. */
export const cidrSchema = z
  .string()
  .superRefine((value, ctx) => {
    const parsed = parseCidr(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
    }
  })
  .transform((value) => {
    const parsed = parseCidr(value);
    return parsed.ok ? parsed.value : value;
  });

export const allowlistEntrySchema = z.object({
  cidr: cidrSchema,
  label: z.string().trim().max(60, 'Keep the label under 60 characters.').nullable(),
});
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

/**
 * Replaces the whole list in one request — the firewall is written as a whole
 * anyway, so a per-entry API would only invent states that cannot exist.
 */
export const allowlistPutSchema = z
  .object({
    entries: z
      .array(allowlistEntrySchema)
      .max(MAX_ALLOWLIST_ENTRIES, `Up to ${MAX_ALLOWLIST_ENTRIES} sources per database.`),
  })
  .transform(({ entries }) => {
    const seen = new Set<string>();
    return {
      entries: entries.filter((entry) => {
        if (seen.has(entry.cidr)) return false;
        seen.add(entry.cidr);
        return true;
      }),
    };
  });
export type AllowlistPutInput = { entries: AllowlistEntry[] };

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
  allowlist: z.array(allowlistEntrySchema),
  /**
   * `conflictingRule` describes a firewall rule this app does not own that also
   * covers this database's port. While one exists the allowlist can only widen
   * access, never narrow it, and the UI has to say so.
   */
  firewall: z.object({
    managed: z.boolean(),
    reachable: z.boolean(),
    conflictingRule: z.string().nullable(),
  }),
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
  // SSL is not settable through the Coolify API (4.3.21); this step configures
  // public access only, and SSL is read back and surfaced as a warning.
  configure: 'Configuring access',
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
  status: z.enum(['pending', 'running', 'paused', 'done', 'failed']),
  steps: z.array(jobStepSchema),
  error: z.string().nullable(),
  result: z.object({ uuid: z.string() }).nullable(),
  /**
   * True when the Coolify resource exists but a later step failed — the UI says
   * "created but not fully configured" rather than pretending nothing happened.
   */
  partial: z.boolean(),
  /**
   * Set when the job is `paused` and waiting on the operator. Coolify 4.3.21
   * cannot enable SSL through its API, and only applies SSL when the data
   * directory is first created — so the job stops before the first start,
   * while turning it on in the Coolify UI still takes effect.
   */
  pausedReason: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const metaResponseSchema = z.object({
  coolifyVersion: z.string().nullable(),
  coolifyUrl: z.string(),
  projectName: z.string().nullable(),
  projectUuid: z.string().nullable(),
  environment: z.string(),
  /** Needed for Coolify deep links, which match the environment by uuid. */
  environmentUuid: z.string().nullable(),
  publicHost: z.string(),
  portRange: z.object({ start: z.number(), end: z.number() }),
  backupsSupported: z.boolean(),
  /** False when HCLOUD_TOKEN/HCLOUD_FIREWALL_ID are unset: no allowlist UI. */
  firewallEnabled: z.boolean(),
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
  'allowlist_update',
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
