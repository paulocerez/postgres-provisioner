import type { AuditAction } from '@app/shared';
import { db } from './db/client.js';
import { auditLog } from './db/schema.js';

/** Keys whose values must never reach the audit log or a log line. */
const SECRET_KEY = /(password|passwd|secret|token|dsn|url|uri|connection)/i;
const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s"']+/gi;

export function redactString(input: string): string {
  return input.replace(CONNECTION_STRING, 'postgres://[redacted]');
}

/**
 * Deep-redacts anything password-shaped. Applied to every `details` payload and
 * to Coolify error bodies before they are stored or logged.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  actor: string;
  action: AuditAction;
  targetUuid?: string | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Written in the same request as the mutation it describes, after the Coolify
 * call resolves — with `details.error` set if it failed.
 */
export function writeAudit(entry: AuditInput): void {
  db.insert(auditLog)
    .values({
      at: Date.now(),
      actor: entry.actor,
      action: entry.action,
      targetUuid: entry.targetUuid ?? null,
      targetName: entry.targetName ?? null,
      details: entry.details ? JSON.stringify(redact(entry.details)) : null,
    })
    .run();
}
