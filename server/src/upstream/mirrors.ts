import dns from 'node:dns/promises';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Config } from '../config.js';
import { safeFetch } from '../security/ssrfGuard.js';

export const USER_AGENT = 'WorldWaveRadio/1.0 (+https://github.com/MANISH50/radio-webapp)';
const DISCOVERY_HOST = 'all.api.radio-browser.info';
// Last-resort list if both DNS discovery and the server-list endpoint fail.
const STATIC_FALLBACK = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const DOWN_FOR_MS = 60_000;

/** Upstream host allowlist: exact names, or suffixes when the entry starts with ".". */
export function isAllowedUpstreamHost(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase();
  return allowlist.some((entry) => (entry.startsWith('.') ? h.endsWith(entry) && h.length > entry.length : h === entry));
}

function allowedBases(bases: string[], cfg: Config): string[] {
  const out = new Set<string>();
  for (const base of bases) {
    try {
      const url = new URL(base);
      const schemeOk = url.protocol === 'https:' || (cfg.upstreamAllowPrivate && url.protocol === 'http:');
      if (schemeOk && isAllowedUpstreamHost(url.hostname, cfg.upstreamAllowedHosts)) out.add(url.origin);
    } catch {
      /* ignore malformed entries */
    }
  }
  return [...out];
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function viaDns(): Promise<string[]> {
  // The API's documented method: resolve the round-robin name, reverse-resolve each IP.
  const ips = await dns.resolve4(DISCOVERY_HOST);
  const names = await Promise.all(ips.map((ip) => dns.reverse(ip).then((n) => n[0] ?? null, () => null)));
  return names.filter((n): n is string => Boolean(n)).map((n) => `https://${n}`);
}

const ServerList = z.array(z.object({ name: z.string().min(1).max(253) })).max(100);

async function viaServerList(cfg: Config): Promise<string[]> {
  const res = await safeFetch(`https://${DISCOVERY_HOST}/json/servers`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    allowHost: (h) => isAllowedUpstreamHost(h, cfg.upstreamAllowedHosts),
    timeoutMs: 5000,
    maxBytes: 64 * 1024,
  });
  if (res.status !== 200) return [];
  return ServerList.parse(JSON.parse(res.body.toString('utf8'))).map((s) => `https://${s.name}`);
}

/** Finds usable mirrors at startup; every candidate is filtered through the host allowlist. */
export async function discoverMirrors(cfg: Config, log: Logger): Promise<string[]> {
  if (cfg.mirrors) {
    const configured = allowedBases(cfg.mirrors, cfg);
    if (!configured.length) throw new Error('RB_MIRRORS contains no allowlisted mirror');
    return configured;
  }
  for (const [method, find] of [
    ['dns', viaDns],
    ['server-list', () => viaServerList(cfg)],
  ] as const) {
    try {
      const found = allowedBases(await find(), cfg);
      if (found.length) {
        log.info({ method, mirrors: found }, 'discovered radio-browser mirrors');
        return shuffle(found);
      }
    } catch (err) {
      log.warn({ err, method }, 'mirror discovery failed');
    }
  }
  log.warn('using static mirror fallback list');
  return shuffle(allowedBases(STATIC_FALLBACK.map((h) => `https://${h}`), cfg));
}

/** Round-robin-free failover: healthy mirrors in order, recently failed ones last. */
export class MirrorPool {
  private readonly downUntil = new Map<string, number>();

  constructor(private readonly bases: string[]) {
    if (!bases.length) throw new Error('MirrorPool needs at least one mirror');
  }

  order(now = Date.now()): string[] {
    const healthy = this.bases.filter((b) => (this.downUntil.get(b) ?? 0) <= now);
    const down = this.bases.filter((b) => (this.downUntil.get(b) ?? 0) > now);
    return [...healthy, ...down];
  }

  markDown(base: string, now = Date.now()): void {
    this.downUntil.set(base, now + DOWN_FOR_MS);
  }

  markUp(base: string): void {
    this.downUntil.delete(base);
  }
}
