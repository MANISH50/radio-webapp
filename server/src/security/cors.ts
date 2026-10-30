import type { Request, RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';

function refererOrigin(req: Request): string | null {
  const ref = req.get('referer');
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

/** Strict CORS: only allowlisted origins get CORS headers; foreign preflights are refused. */
export function cors(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('origin');
    const isAllowed = origin !== undefined && allowed.has(origin);
    if (isAllowed) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      if (!isAllowed) return next(forbidden('ORIGIN_REJECTED', 'Origin not allowed'));
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      res.set('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Server-side provenance check (CORS alone does not stop the request from reaching us):
 * - Sec-Fetch-Site, when sent, must be "same-origin" (or "same-site"/"cross-site" from an
 *   explicitly allowlisted Origin). "none" means a typed URL or bookmark, not the app.
 * - Origin, or failing that the Referer's origin, must be on the allowlist.
 * Requests carrying neither are not from our page in a browser and are rejected.
 */
export function originGuard(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    const source = origin ?? refererOrigin(req);

    if (!source || !allowed.has(source)) {
      return next(forbidden('ORIGIN_REJECTED', 'Origin not allowed'));
    }
    if (site !== undefined && site !== 'same-origin') {
      const explicitCors = origin !== undefined && allowed.has(origin) && (site === 'same-site' || site === 'cross-site');
      if (!explicitCors) return next(forbidden('ORIGIN_REJECTED', 'Cross-site request rejected'));
    }
    next();
  };
}
