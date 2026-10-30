import { type Continent, continentOf } from '../lib/continents.js';
import { cleanList, cleanText, safeHttpUrl } from '../lib/sanitize.js';
import type { RawCountry, RawStation } from '../upstream/schemas.js';

/** The station shape sent to the browser. All strings are plain text; URLs are http(s). */
export interface Station {
  uuid: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  logo: string | null;
  tags: string[];
  languages: string[];
  country: string;
  countryCode: string;
  codec: string;
  bitrate: number;
  hls: boolean;
  https: boolean;
  votes: number;
  clicks: number;
}

export interface Country {
  code: string;
  name: string;
  continent: Continent;
  stationCount: number;
}

export function toStation(raw: RawStation, includeHttp: boolean): Station | null {
  if (raw.lastcheckok !== 1) return null; // hide stations the API marks broken
  const streamUrl = safeHttpUrl(raw.url_resolved) ?? safeHttpUrl(raw.url);
  if (!streamUrl) return null;
  const https = streamUrl.startsWith('https:');
  if (!https && !includeHttp) return null;

  const name = cleanText(raw.name, 120);
  if (!name) return null;

  const logo = safeHttpUrl(raw.favicon);
  const code = raw.countrycode.toUpperCase();
  return {
    uuid: raw.stationuuid.toLowerCase(),
    name,
    streamUrl,
    homepage: safeHttpUrl(raw.homepage),
    logo: logo && (includeHttp || logo.startsWith('https:')) ? logo : null,
    tags: cleanList(raw.tags, 8, 32),
    languages: cleanList(raw.language, 4, 32),
    country: cleanText(raw.country, 80),
    countryCode: /^[A-Z]{2}$/.test(code) ? code : '',
    codec: cleanText(raw.codec, 16).toUpperCase(),
    bitrate: Math.min(raw.bitrate, 10_000),
    hls: raw.hls === 1 || /\.m3u8(?:$|\?)/i.test(streamUrl),
    https,
    votes: raw.votes,
    clicks: raw.clickcount,
  };
}

/** Merges duplicate rows by ISO code and drops countries without stations. */
export function toCountries(rows: RawCountry[]): Country[] {
  const byCode = new Map<string, Country>();
  for (const row of rows) {
    const code = row.iso_3166_1.toUpperCase();
    const name = cleanText(row.name, 80);
    if (!name) continue;
    const existing = byCode.get(code);
    if (existing) existing.stationCount += row.stationcount;
    else byCode.set(code, { code, name, continent: continentOf(code), stationCount: row.stationcount });
  }
  return [...byCode.values()].filter((c) => c.stationCount > 0).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
