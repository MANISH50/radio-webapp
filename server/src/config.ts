import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const flag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number, min = 1, max = 100_000) =>
  z.coerce.number().int().min(min).max(max).default(def);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(8080, 1, 65535),
  HOST: z.string().min(1).default('0.0.0.0'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').optional(),
  TRUST_PROXY: int(0, 0, 10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  RB_MIRRORS: z.string().optional(),
  UPSTREAM_ALLOWED_HOSTS: z.string().default('.api.radio-browser.info'),
  UPSTREAM_ALLOW_PRIVATE: flag.default(false),
  INCLUDE_HTTP_STREAMS: flag.optional(),
  RATE_READ_PER_MIN: int(60),
  RATE_READ_IP_PER_MIN: int(120),
  RATE_CLICK_PER_MIN: int(10),
  RATE_CLICK_IP_PER_MIN: int(20),
  RATE_SESSION_IP_PER_MIN: int(20),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STATIC_DIR: z.string().optional(),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Exact origins (scheme://host[:port]) allowed to call the API. */
  allowedOrigins: string[];
  /** Canonical origin used for HTTP→HTTPS redirects (never taken from the Host header). */
  publicOrigin: string;
  sessionSecret: Buffer;
  trustProxy: number;
  redisUrl?: string;
  /** Explicit upstream mirror base URLs; when unset they are discovered at startup. */
  mirrors?: string[];
  /** Upstream host allowlist. Entries starting with "." match that suffix. */
  upstreamAllowedHosts: string[];
  /** Test-only escape hatch so the E2E suite can use a loopback mock upstream. */
  upstreamAllowPrivate: boolean;
  /** Serve plain-HTTP stream/logo URLs (mixed content on HTTPS sites). */
  includeHttpStreams: boolean;
  limits: {
    readPerToken: number;
    readPerIp: number;
    clickPerToken: number;
    clickPerIp: number;
    sessionPerIp: number;
  };
  logLevel: string;
  staticDir?: string;
}

function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const o of origins) {
    let parsed: URL;
    try {
      parsed = new URL(o);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid URL: ${o}`);
    }
    if (parsed.origin !== o || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`ALLOWED_ORIGINS entries must be bare origins like https://example.com (got ${o})`);
    }
  }
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS must list at least one origin');
  return origins;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `REDIS_URL=` in .env) as unset.
  const env = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const e = EnvSchema.parse(env);

  if (e.NODE_ENV === 'production' && !e.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production');
  }
  if (e.UPSTREAM_ALLOW_PRIVATE && e.NODE_ENV !== 'test') {
    throw new Error('UPSTREAM_ALLOW_PRIVATE may only be enabled when NODE_ENV=test');
  }

  const allowedOrigins = parseOrigins(e.ALLOWED_ORIGINS);
  const mirrors = e.RB_MIRRORS?.split(',')
    .map((m) => m.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    allowedOrigins,
    publicOrigin: allowedOrigins.find((o) => o.startsWith('https:')) ?? allowedOrigins[0]!,
    // Without a configured secret (dev/test only) sessions do not survive restarts.
    sessionSecret: e.SESSION_SECRET ? Buffer.from(e.SESSION_SECRET, 'utf8') : randomBytes(32),
    trustProxy: e.TRUST_PROXY,
    redisUrl: e.REDIS_URL,
    mirrors: mirrors?.length ? mirrors : undefined,
    upstreamAllowedHosts: e.UPSTREAM_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    upstreamAllowPrivate: e.UPSTREAM_ALLOW_PRIVATE,
    includeHttpStreams: e.INCLUDE_HTTP_STREAMS ?? e.NODE_ENV !== 'production',
    limits: {
      readPerToken: e.RATE_READ_PER_MIN,
      readPerIp: e.RATE_READ_IP_PER_MIN,
      clickPerToken: e.RATE_CLICK_PER_MIN,
      clickPerIp: e.RATE_CLICK_IP_PER_MIN,
      sessionPerIp: e.RATE_SESSION_IP_PER_MIN,
    },
    logLevel: e.LOG_LEVEL,
    staticDir: e.STATIC_DIR,
  };
}
