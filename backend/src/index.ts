import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pruneExpiredSessions, requireAuth } from './auth.js';
import { CoolifyError, resolveInstance } from './coolify.js';
import { runMigrations } from './db/client.js';
import { env, isProduction, servedOverHttps } from './env.js';
import { pruneOldJobs, resumeRunningJobs } from './jobs.js';
import { csrfGuard, errorHandler, noStore } from './middleware.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { databasesRouter } from './routes/databases.js';
import { jobsRouter } from './routes/jobs.js';
import { metaRouter } from './routes/meta.js';

runMigrations();

const app = express();

// Coolify puts Traefik in front of us: without this, `Secure` cookies and the
// per-IP rate limit both see the proxy instead of the client.
app.set('trust proxy', 1);

// `upgrade-insecure-requests` makes the browser rewrite asset requests to
// https://; on an http:// deployment there is no certificate to upgrade to, so
// the bundle fails to load and the page renders blank. Both it and HSTS follow
// the scheme we are actually served over — see `servedOverHttps` in env.ts.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Vite injects the stylesheet at runtime in dev; inline styles are also
        // used by the bundled CSS in production.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        ...(servedOverHttps ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // HSTS on an http:// origin is meaningless, and once a browser has seen it
    // for this host it will refuse plain http even after you switch domains.
    strictTransportSecurity: servedOverHttps,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser(env.SESSION_SECRET));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/api', noStore, csrfGuard);
app.use('/api/auth', authRouter);
app.use('/api/meta', requireAuth, metaRouter);
app.use('/api/databases', requireAuth, databasesRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/audit', requireAuth, auditRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { message: 'No such endpoint.' } });
});

// In production Express serves the built SPA; in dev, Vite does, and proxies
// /api here.
if (isProduction) {
  const clientDir = path.resolve(import.meta.dirname, '../../frontend/dist');
  app.use(express.static(clientDir, { index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.use(errorHandler);

function schedulePeriodicCleanup(): void {
  const hourly = () => {
    const sessions = pruneExpiredSessions();
    const jobs = pruneOldJobs();
    if (sessions || jobs) console.log(`[cleanup] pruned ${sessions} sessions, ${jobs} jobs`);
  };
  hourly();
  setInterval(hourly, 60 * 60 * 1000).unref();
}

async function main(): Promise<void> {
  schedulePeriodicCleanup();

  // Resolving the Coolify project must not stop the server from booting — the
  // UI has to be reachable in order to *show* that Coolify is unreachable.
  try {
    const resolved = await resolveInstance();
    console.log(
      `[coolify] ${env.COOLIFY_URL} version=${resolved.version ?? 'unknown'} project=${resolved.projectName ?? resolved.projectUuid} backups=${resolved.backupsSupported ? 'supported' : 'unsupported'}`,
    );
  } catch (err) {
    const message = err instanceof CoolifyError ? err.message : String(err);
    console.error(`[coolify] startup check failed: ${message}`);
    console.error('[coolify] the app will start, but database operations will fail until this is fixed.');
  }

  // Runs even when the Coolify check failed: a job left `running` by a restart
  // must be resolved one way or the other, never left hanging.
  await resumeRunningJobs().catch((err: unknown) => {
    console.error('[jobs] could not resume in-flight jobs:', err);
  });

  app.listen(env.PORT, () => {
    console.log(`[server] listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

void main();

export { app };
