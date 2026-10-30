import type { Request, RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import { ok } from '../lib/envelope.js';
import { unauthorized } from '../lib/errors.js';
import {
  type IssuedSession,
  issueSession,
  MAX_SESSION_SEC,
  ROTATE_BEFORE_SEC,
  type SessionToken,
  TOKEN_TTL_SEC,
  verifyToken,
} from '../lib/token.js';

export const SESSION_COOKIE = 'ww_session';
export const CSRF_COOKIE = 'ww_csrf';

declare module 'express-serve-static-core' {
  interface Locals {
    session?: SessionToken;
  }
}

function setSessionCookies(res: Response, s: IssuedSession): void {
  res.cookie(SESSION_COOKIE, s.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: TOKEN_TTL_SEC * 1000,
  });
  // Readable by the page for the double-submit header; useless to other origins.
  res.cookie(CSRF_COOKIE, s.csrf, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_SESSION_SEC * 1000,
  });
  res.set('X-Session-Expires', String(s.payload.exp * 1000));
}

function currentSession(req: Request, cfg: Config): SessionToken | null {
  return verifyToken(req.cookies?.[SESSION_COOKIE], cfg.sessionSecret);
}

const withinLifetime = (s: SessionToken) => Date.now() / 1000 - s.sst < MAX_SESSION_SEC;

/** GET /api/session: called on page load and before expiry; issues or rotates the token. */
export function sessionBootstrap(cfg: Config): RequestHandler {
  return (req, res) => {
    const existing = currentSession(req, cfg);
    const issued = issueSession(cfg.sessionSecret, existing && withinLifetime(existing) ? existing : undefined);
    setSessionCookies(res, issued);
    res.json(ok({ csrfToken: issued.csrf, expiresAt: issued.payload.exp * 1000 }));
  };
}

/** Every /api/v1 call needs a valid, unexpired token; near-expiry tokens are rotated silently. */
export function requireSession(cfg: Config): RequestHandler {
  return (req, res, next) => {
    const session = currentSession(req, cfg);
    if (!session) return next(unauthorized());
    res.locals.session = session;
    if (session.exp - Date.now() / 1000 < ROTATE_BEFORE_SEC && withinLifetime(session)) {
      setSessionCookies(res, issueSession(cfg.sessionSecret, session));
    }
    next();
  };
}
