import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loginSchema } from '@app/shared';
import bcrypt from 'bcryptjs';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { writeAudit } from './audit.js';
import { db, sqlite } from './db/client.js';
import { sessions } from './db/schema.js';
import { env, servedOverHttps } from './env.js';

/**
 * All authentication lives behind this module. Swapping the single admin for an
 * OAuth provider later means rewriting this file and nothing else: the rest of
 * the app only knows about `requireAuth` and `req.session.email`.
 */

const COOKIE_NAME = 'pp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: { email: string };
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Keyed to the scheme we are actually served over, not to NODE_ENV: a
    // `Secure` cookie on an http:// origin is silently dropped by the browser.
    secure: servedOverHttps,
    path: '/',
    maxAge: SESSION_TTL_MS,
    // Signed with SESSION_SECRET so a tampered cookie is rejected before it
    // ever reaches the session table.
    signed: true,
  };
}

/** The cookie is signed, so it arrives on `signedCookies`, not `cookies`. */
function readSessionCookie(req: Request): string | null {
  const raw = req.signedCookies?.[COOKIE_NAME];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Compares two strings without leaking their length through timing. Both sides
 * are hashed first so `timingSafeEqual` always sees equal-length buffers.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Hot path: runs on every authenticated request, so it is a prepared statement.
 * Prepared lazily — ES module imports are evaluated before `runMigrations()` in
 * index.ts, so the table does not exist yet at import time.
 */
let lookupSession: ReturnType<typeof prepareLookup> | null = null;

function prepareLookup() {
  return sqlite.prepare<[string, number], { email: string }>(
    'SELECT email FROM sessions WHERE id = ? AND expires_at > ?',
  );
}

export function getSession(req: Request): { email: string } | null {
  const raw = readSessionCookie(req);
  if (!raw) return null;
  lookupSession ??= prepareLookup();
  const row = lookupSession.get(hashToken(raw), Date.now());
  return row ? { email: row.email } : null;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: { message: 'Not authenticated.' } });
    return;
  }
  req.session = session;
  next();
};

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Try again in 15 minutes.' } },
});

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: GENERIC_LOGIN_ERROR } });
      return;
    }
    const { email, password } = parsed.data;

    // Always run the bcrypt compare, even for an unknown email, so a wrong
    // email and a wrong password take the same time and return the same text.
    const emailMatches = safeEqual(email.trim().toLowerCase(), env.ADMIN_EMAIL.toLowerCase());
    const passwordMatches = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);

    if (!emailMatches || !passwordMatches) {
      writeAudit({ actor: email, action: 'login_failed', details: { ip: req.ip ?? null } });
      res.status(401).json({ error: { message: GENERIC_LOGIN_ERROR } });
      return;
    }

    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    db.insert(sessions)
      .values({
        id: hashToken(token),
        email: env.ADMIN_EMAIL,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      })
      .run();

    writeAudit({ actor: env.ADMIN_EMAIL, action: 'login', details: { ip: req.ip ?? null } });
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ email: env.ADMIN_EMAIL });
  } catch (err) {
    next(err);
  }
}

export const logoutHandler: RequestHandler = (req, res) => {
  // Revoked server-side: deleting the row is what actually ends the session.
  const raw = readSessionCookie(req);
  if (raw) {
    db.delete(sessions).where(eq(sessions.id, hashToken(raw))).run();
  }
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
};

export const meHandler: RequestHandler = (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: { message: 'Not authenticated.' } });
    return;
  }
  res.json({ email: session.email });
};

/** Called on startup and hourly. Expired rows are dead weight, not state. */
export function pruneExpiredSessions(): number {
  const result = db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  return result.changes;
}

/** Exposed for tests / future admin tooling: how many sessions are still live. */
export function countActiveSessions(): number {
  return db
    .select()
    .from(sessions)
    .where(and(gt(sessions.expiresAt, Date.now())))
    .all().length;
}
