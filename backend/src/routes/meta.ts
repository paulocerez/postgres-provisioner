import type { MetaResponse } from '@app/shared';
import { Router } from 'express';
import { ensureResolved, getResolved } from '../coolify.js';
import { env, firewallManaged } from '../env.js';
import { asyncHandler } from '../middleware.js';

export const metaRouter: Router = Router();

/**
 * Instance facts the client needs: PUBLIC_HOST for connection strings (never
 * derived from COOLIFY_URL), the port range, and whether backups are supported.
 *
 * Retries resolution if startup failed, so fixing Coolify (its API allowlist,
 * say) takes effect on the next page load rather than needing a restart. A
 * still-unreachable Coolify degrades to nulls instead of failing the request —
 * this feeds the footer, not a decision.
 */
metaRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    await ensureResolved().catch(() => null);
    const resolved = getResolved();
    const body: MetaResponse = {
      coolifyVersion: resolved?.version ?? null,
      coolifyUrl: env.COOLIFY_URL,
      projectName: resolved?.projectName ?? null,
      projectUuid: resolved?.projectUuid ?? null,
      environment: env.COOLIFY_ENVIRONMENT,
      publicHost: env.PUBLIC_HOST,
      portRange: { start: env.PORT_RANGE_START, end: env.PORT_RANGE_END },
      backupsSupported: resolved?.backupsSupported ?? false,
      firewallEnabled: firewallManaged,
      defaultImage: env.DEFAULT_PG_IMAGE,
    };
    res.json(body);
  }),
);
