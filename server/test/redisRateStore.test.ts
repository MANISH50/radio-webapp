import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import pino from 'pino';
import { afterAll, describe, expect, it } from 'vitest';
import { RedisRateStore } from '../src/security/rateLimit.js';

// Runs only when a Redis is available, e.g. TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RedisRateStore (sliding window)', () => {
  const redis = new Redis(url ?? 'redis://127.0.0.1:6379', { lazyConnect: true });
  const store = new RedisRateStore(redis, pino({ level: 'silent' }));
  afterAll(() => redis.quit());

  it('admits up to the limit, then rejects with Retry-After', async () => {
    const key = `test:${randomUUID()}`;
    const now = Date.now();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.hit(key, 60_000, 3, now + i));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSec).toBe(60);
  });

  it('slides: old hits leave the window', async () => {
    const key = `test:${randomUUID()}`;
    const now = Date.now();
    await store.hit(key, 1000, 1, now);
    expect((await store.hit(key, 1000, 1, now + 500)).allowed).toBe(false);
    expect((await store.hit(key, 1000, 1, now + 1001)).allowed).toBe(true);
  });
});
