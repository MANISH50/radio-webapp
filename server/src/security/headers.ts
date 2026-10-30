import type { RequestHandler } from 'express';
import helmet from 'helmet';
import type { Config } from '../config.js';
import { sendError } from '../lib/envelope.js';

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=(self)',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
].join(', ');

export function securityHeaders(cfg: Config): RequestHandler[] {
  // Logos and streams come from thousands of station hosts, so img/media/connect allow any
  // https: origin (hls.js fetches playlists via XHR, hence connect-src). Plain http: is only
  // added when HTTP streams are deliberately enabled (see README, "Mixed content").
  const remote = cfg.includeHttpStreams ? ['https:', 'http:'] : ['https:'];
  const production = cfg.env === 'production';

  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', ...remote],
          mediaSrc: ["'self'", 'blob:', ...remote],
          connectSrc: ["'self'", ...remote],
          fontSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(production && !cfg.includeHttpStreams ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: production ? { maxAge: 63_072_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // COEP would require every station logo/stream host to opt in; it cannot apply here.
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
      xContentTypeOptions: true,
    }),
    (_req, res, next) => {
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      next();
    },
  ];
}

/** In production, plain-HTTP requests are redirected to the canonical HTTPS origin. */
export function httpsRedirect(cfg: Config): RequestHandler {
  return (req, res, next) => {
    if (cfg.env !== 'production' || req.secure || req.path === '/api/v1/health') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 403, 'HTTPS_REQUIRED', 'HTTPS is required');
    }
    // Redirect target comes from config, never from the Host header (no open redirect).
    const target = new URL(req.originalUrl, cfg.publicOrigin.replace(/^http:/, 'https:'));
    res.redirect(301, target.toString());
  };
}
