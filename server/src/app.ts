import fs from 'node:fs';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { ok, sendError } from './lib/envelope.js';
import { HttpError, notFound, UpstreamError } from './lib/errors.js';
import { requestLogger } from './logger.js';
import { v1Router } from './routes/v1.js';
import { requireSession, sessionBootstrap } from './security/auth.js';
import { botGuard } from './security/botGuard.js';
import { cors, originGuard } from './security/cors.js';
import { requireCsrf } from './security/csrf.js';
import { httpsRedirect, securityHeaders } from './security/headers.js';
import { byIp, rateLimit, type RateStore } from './security/rateLimit.js';
import type { Catalog } from './services/catalog.js';

export interface AppDeps {
  cfg: Config;
  logger: Logger;
  catalog: Catalog;
  rateStore: RateStore;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** Generic messages for clients; details only in the server log. */
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    sendError(res, err.status, err.code, err.message, err.headers);
    return;
  }
  if (err instanceof UpstreamError) {
    req.log.error({ err }, 'upstream failure');
    sendError(res, 502, 'UPSTREAM_UNAVAILABLE', 'The station directory is temporarily unavailable');
    return;
  }
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) req.log.error({ err }, 'unhandled error');
  sendError(res, status, status === 500 ? 'INTERNAL' : 'BAD_REQUEST', status === 500 ? 'Something went wrong' : 'Bad request');
};

export function createApp({ cfg, logger, catalog, rateStore }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.set('query parser', 'simple');

  app.use(requestLogger(logger, cfg));
  app.use(httpsRedirect(cfg));
  app.use(securityHeaders(cfg));

  app.use('/api', noStore, cors(cfg.allowedOrigins));
  // Liveness only: no version, uptime, mirror or dependency details.
  app.get('/api/v1/health', (_req, res) => {
    res.json(ok({ status: 'ok' }));
  });

  app.use(
    '/api',
    cookieParser(),
    originGuard(cfg.allowedOrigins),
    botGuard(),
    rateLimit({ store: rateStore, name: 'api-ip', limit: cfg.limits.readPerIp, key: byIp(cfg.sessionSecret) }),
  );
  app.get(
    '/api/session',
    rateLimit({ store: rateStore, name: 'session-ip', limit: cfg.limits.sessionPerIp, key: byIp(cfg.sessionSecret) }),
    sessionBootstrap(cfg),
  );
  app.use('/api/v1', requireSession(cfg), requireCsrf(cfg), v1Router({ cfg, catalog, rateStore }));
  app.use('/api', (_req, _res, next) => next(notFound()));

  if (cfg.staticDir && fs.existsSync(cfg.staticDir)) {
    app.use(
      express.static(cfg.staticDir, {
        index: 'index.html',
        setHeaders: (res, filePath) => {
          res.setHeader(
            'Cache-Control',
            /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
  }
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
