import type { Logger } from 'pino';
import type { z } from 'zod';
import type { Config } from '../config.js';
import { UpstreamError } from '../lib/errors.js';
import { safeFetch } from '../security/ssrfGuard.js';
import { isAllowedUpstreamHost, type MirrorPool, USER_AGENT } from './mirrors.js';
import { RawArray, RawClick, RawCountry, RawStation } from './schemas.js';

const MB = 1024 * 1024;

export interface UpstreamApi {
  countries(): Promise<RawCountry[]>;
  stationsByCountry(code: string): Promise<RawStation[]>;
  searchByName(name: string, offset: number, limit: number): Promise<RawStation[]>;
  click(uuid: string): Promise<boolean>;
}

function parseRows<T>(json: unknown, schema: z.ZodType<T>): T[] {
  const rows = RawArray.parse(json);
  const out: T[] = [];
  for (const row of rows) {
    const r = schema.safeParse(row);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Radio Browser client: allowlisted mirrors only, SSRF-guarded transport, failover on error. */
export class RadioBrowserClient implements UpstreamApi {
  constructor(
    private readonly pool: MirrorPool,
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {}

  private async getJson(path: string, maxBytes: number): Promise<unknown> {
    let lastErr: unknown;
    for (const base of this.pool.order()) {
      try {
        const res = await safeFetch(base + path, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          allowHost: (h) => isAllowedUpstreamHost(h, this.cfg.upstreamAllowedHosts),
          allowPrivate: this.cfg.upstreamAllowPrivate,
          timeoutMs: 10_000,
          maxBytes,
          maxRedirects: 2,
        });
        if (res.status >= 500 || res.status === 429) throw new UpstreamError(`mirror returned ${res.status}`);
        if (res.status !== 200) {
          this.pool.markUp(base);
          throw new UpstreamError(`upstream returned ${res.status}`, { cause: 'client' });
        }
        const json: unknown = JSON.parse(res.body.toString('utf8'));
        this.pool.markUp(base);
        return json;
      } catch (err) {
        if (err instanceof UpstreamError && err.cause === 'client') throw err;
        lastErr = err;
        this.pool.markDown(base);
        this.log.warn({ err, mirror: base, path: path.split('?')[0] }, 'upstream mirror failed; trying next');
      }
    }
    throw new UpstreamError('all mirrors failed', { cause: lastErr });
  }

  async countries(): Promise<RawCountry[]> {
    return parseRows(await this.getJson('/json/countries?hidebroken=true', 2 * MB), RawCountry);
  }

  async stationsByCountry(code: string): Promise<RawStation[]> {
    const path = `/json/stations/bycountrycodeexact/${encodeURIComponent(code)}?hidebroken=true&order=clickcount&reverse=true&limit=10000`;
    return parseRows(await this.getJson(path, 40 * MB), RawStation);
  }

  async searchByName(name: string, offset: number, limit: number): Promise<RawStation[]> {
    const qs = new URLSearchParams({
      name,
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      offset: String(offset),
      limit: String(limit),
    });
    return parseRows(await this.getJson(`/json/stations/search?${qs}`, 4 * MB), RawStation);
  }

  async click(uuid: string): Promise<boolean> {
    const json = await this.getJson(`/json/url/${encodeURIComponent(uuid)}`, 64 * 1024);
    const parsed = RawClick.safeParse(json);
    return parsed.success && parsed.data.ok;
  }
}
