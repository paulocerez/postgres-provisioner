import type { MetaResponse } from '@app/shared';
import { Router } from 'express';
import { getResolved } from '../coolify.js';
import { env } from '../env.js';

export const metaRouter: Router = Router();

/**
 * Instance facts the client needs: PUBLIC_HOST for connection strings (never
 * derived from COOLIFY_URL), the port range, and whether backups are supported.
 */
metaRouter.get('/', (_req, res) => {
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
    defaultImage: env.DEFAULT_PG_IMAGE,
  };
  res.json(body);
});
