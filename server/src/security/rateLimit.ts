import { randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { HttpError } from '../lib/errors.js';
import { hashIp } from '../lib/token.js';

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

export interface RateStore {
  hit(key: string, windowMs: number, limit: number, nowMs?: number): Promise<HitResult>;
}

const MAX_KEYS = 100_000;

/** Sliding-window log kept in process memory (single instance deployments and fallback). */
export class MemoryRateStore implements RateStore {
  private readonly windows = new Map<string, number[]>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(sweepEveryMs = 60_000, private readonly maxWindowMs = 60_000) {
    this.sweeper = setInterval(() => this.sweep(), sweepEveryMs);
    this.sweeper.unref();
  }

  async hit(key: string, windowMs: number, limit: number, nowMs = Date.now()): Promise<HitResult> {
    const cutoff = nowMs - windowMs;
    const log = this.windows.get(key) ?? [];
    while (log.length && log[0]! <= cutoff) log.shift();

    if (log.length >= limit) {
      this.windows.set(key, log);
      return { allowed: false, count: log.length, retryAfterSec: Math.max(1, Math.ceil((log[0]! + windowMs - nowMs) / 1000)) };
    }
    if (!this.windows.has(key) && this.windows.size >= MAX_KEYS) {
      // Bound memory under key-flooding: evict the oldest-inserted key.
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    log.push(nowMs);
    this.windows.set(key, log);
    return { allowed: true, count: log.length, retryAfterSec: 0 };
  }

  private sweep(nowMs = Date.now()): void {
    for (const [key, log] of this.windows) {
      if (!log.length || log[log.length - 1]! <= nowMs - this.maxWindowMs) this.windows.delete(key);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
  }
}

// Atomic sliding-window log on a sorted set: trim, count, then admit or reject.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, count, tonumber(oldest[2])}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

/** Redis-backed sliding window shared across instances; falls back to memory if Redis fails. */
export class RedisRateStore implements RateStore {
  private readonly fallback = new MemoryRateStore();

  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  async hit(key: string, windowMs: number, limit: number, nowMs = Date.now()): Promise<HitResult> {
    try {
      const member = `${nowMs}-${randomBytes(6).toString('hex')}`;
      const [allowed, count, oldest] = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `ww:rl:${key}`,
        nowMs,
        windowMs,
        limit,
        member,
      )) as [number, number, number];
      return {
        allowed: allowed === 1,
        count,
        retryAfterSec: allowed === 1 ? 0 : Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)),
      };
    } catch (err) {
      this.log.warn({ err }, 'redis rate limiter unavailable; using in-memory fallback');
      return this.fallback.hit(key, windowMs, limit, nowMs);
    }
  }
}

export type KeyFn = (req: Request, res: Response) => string | null;

export const byIp =
  (secret: Buffer): KeyFn =>
  (req) =>
    `ip:${hashIp(req.ip ?? 'unknown', secret)}`;

export const bySession: KeyFn = (_req, res) => (res.locals.session ? `sid:${res.locals.session.sid}` : null);

export interface RateLimitOptions {
  store: RateStore;
  name: string;
  limit: number;
  key: KeyFn;
  windowMs?: number;
}

export function rateLimit({ store, name, limit, key, windowMs = 60_000 }: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const k = key(req, res);
    if (!k) return next();
    const result = await store.hit(`${name}:${k}`, windowMs, limit);
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - result.count)));
    if (!result.allowed) {
      const retry = String(result.retryAfterSec);
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests, please slow down', { 'Retry-After': retry }));
    }
    next();
  };
}
