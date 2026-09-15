import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { redactString } from './audit.js';
import { CoolifyError } from './coolify.js';
import { env } from './env.js';
import { PortRangeExhaustedError } from './ports.js';

/** Nothing under /api is ever cacheable — several responses contain passwords. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/**
 * CSRF defence in depth on top of the SameSite=Lax cookie: every mutating /api
 * request must come from APP_ORIGIN and must be JSON (which a cross-origin form
 * post cannot be without a preflight).
 */
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const contentType = req.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    res.status(415).json({ error: { message: 'Content-Type must be application/json.' } });
    return;
  }

  const source = req.get('origin') ?? req.get('referer');
  if (!source) {
    res.status(403).json({ error: { message: 'Missing Origin header.' } });
    return;
  }

  let origin: string;
  try {
    origin = new URL(source).origin;
  } catch {
    res.status(403).json({ error: { message: 'Malformed Origin header.' } });
    return;
  }

  if (origin !== new URL(env.APP_ORIGIN).origin) {
    res.status(403).json({ error: { message: 'Cross-origin request rejected.' } });
    return;
  }

  next();
};

/**
 * Single error shape for the whole API: `{ error: { message, step?, coolifyStatus? } }`.
 * Coolify failures keep their detail — the operator needs to see them — but the
 * body is already redacted and truncated by the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.join('.');
    res.status(400).json({
      error: {
        message: first ? `${where ? `${where}: ` : ''}${first.message}` : 'Invalid request body.',
      },
    });
    return;
  }

  if (err instanceof PortRangeExhaustedError) {
    res.status(409).json({ error: { message: err.message } });
    return;
  }

  if (err instanceof CoolifyError) {
    console.error(`[coolify] ${err.status} ${err.endpoint}: ${err.body}`);
    // Always 502: the failure is upstream, not in the client's request.
    res.status(502).json({
      error: { message: err.message, coolifyStatus: err.status || undefined },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error('[error]', redactString(message));
  res.status(500).json({ error: { message: 'Something went wrong. Check the server logs.' } });
};

/**
 * Express types route params as possibly-undefined under
 * `noUncheckedIndexedAccess`; a route can only be reached with its params
 * present, so this narrows without scattering non-null assertions.
 */
export function param(req: { params: Record<string, string | undefined> }, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter "${name}".`);
  return value;
}

/** Wraps an async handler so a rejected promise reaches `errorHandler`. */
export function asyncHandler(
  handler: (...args: Parameters<RequestHandler>) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
