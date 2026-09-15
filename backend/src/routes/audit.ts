import type { AuditEntry } from '@app/shared';
import { desc } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export const auditRouter: Router = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

auditRouter.get('/', (req, res) => {
  const { limit } = querySchema.parse(req.query);
  const rows = db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(limit).all();

  const entries: AuditEntry[] = rows.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action as AuditEntry['action'],
    targetUuid: row.targetUuid,
    targetName: row.targetName,
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
  }));

  res.json(entries);
});
