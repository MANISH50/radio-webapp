import { LRUCache } from 'lru-cache';
import type { Sort, StationQuery } from '../security/validate.js';
import type { UpstreamApi } from '../upstream/radioBrowser.js';
import { type Country, type Station, toCountries, toStation } from './normalize.js';

const HOUR = 60 * 60 * 1000;

export interface Facets {
  tags: string[];
  languages: string[];
  codecs: string[];
}

export interface StationPage {
  items: Station[];
  total: number;
  facets: Facets;
}

export interface SearchPage {
  items: Station[];
  hasMore: boolean;
}

export interface Catalog {
  countries(): Promise<Country[]>;
  countryStations(code: string, query: StationQuery): Promise<StationPage>;
  search(q: string, page: number, limit: number): Promise<SearchPage>;
  click(uuid: string): Promise<boolean>;
}

interface CountryEntry {
  stations: Station[];
  facets: Facets;
}

function topValues(lists: string[][], max: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([v]) => v);
}

const COMPARATORS: Record<Sort, (a: Station, b: Station) => number> = {
  popular: (a, b) => b.clicks - a.clicks || b.votes - a.votes,
  votes: (a, b) => b.votes - a.votes || b.clicks - a.clicks,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  bitrate: (a, b) => b.bitrate - a.bitrate || b.clicks - a.clicks,
};

/** Cached catalogue over the upstream API: countries 24h, station lists and searches 1h. */
export class RadioCatalog implements Catalog {
  private readonly countryCache = new LRUCache<string, Country[]>({ max: 1, ttl: 24 * HOUR });
  private readonly stationCache = new LRUCache<string, CountryEntry>({ max: 250, ttl: HOUR });
  private readonly searchCache = new LRUCache<string, Station[]>({ max: 500, ttl: HOUR });
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly upstream: UpstreamApi,
    private readonly includeHttp: boolean,
  ) {}

  /** Collapses concurrent misses for the same key into one upstream call. */
  private async cached<T extends object>(cache: LRUCache<string, T>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = load()
      .then((v) => {
        cache.set(key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private normalise(rows: Awaited<ReturnType<UpstreamApi['stationsByCountry']>>): Station[] {
    const seen = new Set<string>();
    const out: Station[] = [];
    for (const row of rows) {
      const s = toStation(row, this.includeHttp);
      if (s && !seen.has(s.uuid)) {
        seen.add(s.uuid);
        out.push(s);
      }
    }
    return out;
  }

  countries(): Promise<Country[]> {
    return this.cached(this.countryCache, 'countries', async () => toCountries(await this.upstream.countries()));
  }

  async countryStations(code: string, q: StationQuery): Promise<StationPage> {
    const entry = await this.cached(this.stationCache, `country:${code}`, async () => {
      const stations = this.normalise(await this.upstream.stationsByCountry(code));
      return {
        stations,
        facets: {
          tags: topValues(stations.map((s) => s.tags), 30),
          languages: topValues(stations.map((s) => s.languages), 20),
          codecs: topValues(stations.map((s) => (s.codec ? [s.codec] : [])), 10),
        },
      };
    });

    const filtered = entry.stations.filter(
      (s) =>
        (!q.tag || s.tags.includes(q.tag)) &&
        (!q.lang || s.languages.includes(q.lang)) &&
        (!q.codec || s.codec === q.codec) &&
        (q.minBitrate === undefined || s.bitrate >= q.minBitrate) &&
        (!q.httpsOnly || s.https),
    );
    filtered.sort(COMPARATORS[q.sort]);
    const start = (q.page - 1) * q.limit;
    return { items: filtered.slice(start, start + q.limit), total: filtered.length, facets: entry.facets };
  }

  async search(q: string, page: number, limit: number): Promise<SearchPage> {
    const offset = (page - 1) * limit;
    // Fetch one extra row to know whether another page exists.
    const rows = await this.cached(this.searchCache, `search:${q.toLowerCase()}:${offset}:${limit}`, async () =>
      this.normalise(await this.upstream.searchByName(q, offset, limit + 1)),
    );
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  click(uuid: string): Promise<boolean> {
    return this.upstream.click(uuid);
  }
}
