import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { csrfFor, safeEqual } from '../lib/token.js';
import { CSRF_COOKIE } from './auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check for state-changing requests: the X-CSRF-Token header must
 * equal the ww_csrf cookie, and both must be the HMAC of the current session id, so a
 * cookie planted by a sibling subdomain cannot be paired with a forged header.
 * Must run after requireSession.
 */
export function requireCsrf(cfg: Config): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const header = req.get('x-csrf-token');
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const session = res.locals.session;
    if (
      !session ||
      !header ||
      typeof cookie !== 'string' ||
      !safeEqual(header, cookie) ||
      !safeEqual(header, csrfFor(session.sid, cfg.sessionSecret))
    ) {
      return next(forbidden('CSRF_FAILED', 'Request could not be verified'));
    }
    next();
  };
}
