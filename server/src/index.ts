import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { MemoryRateStore, type RateStore, RedisRateStore } from './security/rateLimit.js';
import { RadioCatalog } from './services/catalog.js';
import { discoverMirrors, MirrorPool } from './upstream/mirrors.js';
import { RadioBrowserClient } from './upstream/radioBrowser.js';

const cfg = loadConfig();
const logger = createLogger(cfg);

if (!process.env.SESSION_SECRET) logger.warn('SESSION_SECRET not set; using a random per-process secret');

const mirrors = await discoverMirrors(cfg, logger);
const upstream = new RadioBrowserClient(new MirrorPool(mirrors), cfg, logger);
const catalog = new RadioCatalog(upstream, cfg.includeHttpStreams);

let redis: Redis | undefined;
let rateStore: RateStore;
if (cfg.redisUrl) {
  redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  redis.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
  rateStore = new RedisRateStore(redis, logger);
} else {
  rateStore = new MemoryRateStore();
}

const app = createApp({ cfg, logger, catalog, rateStore });
const server = app.listen(cfg.port, cfg.host, () => {
  logger.info({ port: cfg.port, env: cfg.env, mirrors: mirrors.length, redis: Boolean(redis) }, 'WorldWave Radio listening');
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void redis?.quit();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
