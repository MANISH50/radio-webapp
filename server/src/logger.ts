import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { hashIp } from './lib/token.js';

export function createLogger(cfg: Pick<Config, 'logLevel'>): Logger {
  return pino({
    level: cfg.logLevel,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        'headers.cookie',
        '*.token',
        '*.csrfToken',
      ],
      censor: '[redacted]',
    },
  });
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Structured access log with request ids. IPs are logged only as keyed hashes. */
export function requestLogger(logger: Logger, cfg: Config) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customProps: (req) => ({ ipHash: hashIp((req as Request).ip ?? 'unknown', cfg.sessionSecret) }),
    serializers: {
      // Path only: query strings may contain user search terms.
      req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
  });
}
